const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// 🌟 SECURE FIREBASE URL FROM GITHUB SECRETS 🌟
const FIREBASE_URL = process.env.FIREBASE_URL;

const inquiryStates = {}; // Track user inquiry flow

// ========== 🔥 FETCH PROPERTIES FROM FIREBASE ==========
async function getPropertiesFromApp() {
    try {
        const response = await fetch(`${FIREBASE_URL}/properties.json`);
        const data = await response.json();
        if (!data) return [];
        
        return Object.keys(data).map(key => ({
            id: key,
            title: data[key].title,
            type: data[key].type,
            price: data[key].price,
            location: data[key].location,
            area: data[key].area,
            bedrooms: data[key].bedrooms,
            bathrooms: data[key].bathrooms,
            imageUrl: data[key].imageUrl,
            description: data[key].description,
            ownerName: data[key].ownerName,
            ownerPhone: data[key].ownerPhone,
            listingType: data[key].listingType,
            floor: data[key].floor,
            parking: data[key].parking,
            furnishing: data[key].furnishing,
            age: data[key].age,
            facing: data[key].facing
        }));
    } catch (error) {
        console.error("Failed to fetch properties:", error);
        return [];
    }
}

async function startBot() {
    if (!FIREBASE_URL) {
        console.log("❌ ERROR: FIREBASE_URL is missing in GitHub Secrets!");
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["TaneHome", "Bot", "1"]
    });

    // ========== 🔌 CONNECTION EVENTS ==========
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.clear();
            console.log('\n==================================================');
            console.log('🏢 TANEHOME.COM REAL ESTATE BOT');
            console.log('⚠️ QR CODE TOO BIG? CLICK "View raw logs" IN TOP RIGHT!');
            console.log('==================================================\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') console.log('✅ TANEHOME.COM BOT IS ONLINE!');
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ========== 💬 MESSAGE HANDLER ==========
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        console.log(`📩 [TaneHome] Query: ${text}`);

        // ========== 📋 STEP 3: SAVE INQUIRY TO FIREBASE ==========
        if (inquiryStates[sender]?.step === 'WAITING_FOR_DETAILS') {
            const customerDetails = text;
            const property = inquiryStates[sender].property;
            const customerWaNumber = sender.split('@')[0];

            const taneHomeInquiry = {
                userId: "whatsapp_" + customerWaNumber,
                customerPhone: customerWaNumber,
                customerDetails: customerDetails,
                propertyId: property.id,
                propertyTitle: property.title,
                propertyType: property.type,
                propertyPrice: property.price,
                propertyLocation: property.location,
                listingType: property.listingType,
                status: "New Inquiry",
                source: "WhatsApp Bot",
                timestamp: new Date().toISOString()
            };

            try {
                await fetch(`${FIREBASE_URL}/inquiries.json`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(taneHomeInquiry)
                });
            } catch (error) {
                console.log("Firebase Error: ", error);
            }

            await sock.sendMessage(sender, {
                text: `✅ *Inquiry Submitted Successfully!*\n\n🏠 *Property:* ${property.title}\n📍 *Location:* ${property.location}\n💰 *Price:* ₹${property.price}\n\n📋 *Your Details:*\n${customerDetails}\n\n🙏 _Thank you for choosing TaneHome!_\n\n⏱️ Our property expert will contact you within *30 minutes*.\n🌐 Visit: *thanehome.com* for more details.`
            });

            delete inquiryStates[sender];
            return;
        }

        // ========== 🔍 STEP 2: PROPERTY DETAILS + IMAGE ==========
        if (text.startsWith("details ") || text.startsWith("info ")) {
            const propertyQuery = text.replace("details ", "").replace("info ", "").trim();
            const currentProperties = await getPropertiesFromApp();
            const matchedProperty = currentProperties.find(p => p.title.toLowerCase().includes(propertyQuery));

            if (!matchedProperty) {
                await sock.sendMessage(sender, {
                    text: `❌ Sorry, we couldn't find *${propertyQuery}*.\n\nType *properties* to see all available listings.\n🌐 Or visit *thanehome.com*`
                });
                return;
            }

            const listingLabel = matchedProperty.listingType === 'rent' ? '🏠 FOR RENT' : '🏷️ FOR SALE';
            
            let detailsText = `${listingLabel}\n\n`;
            detailsText += `🏢 *${matchedProperty.title}*\n`;
            detailsText += `📍 *Location:* ${matchedProperty.location}\n`;
            detailsText += `💰 *Price:* ₹${matchedProperty.price}\n`;
            detailsText += `📐 *Area:* ${matchedProperty.area}\n`;
            detailsText += `🛏️ *Bedrooms:* ${matchedProperty.bedrooms || 'N/A'}\n`;
            detailsText += `🚿 *Bathrooms:* ${matchedProperty.bathrooms || 'N/A'}\n`;
            detailsText += `📄 *Type:* ${matchedProperty.type}\n`;
            
            if (matchedProperty.floor) detailsText += `🏗️ *Floor:* ${matchedProperty.floor}\n`;
            if (matchedProperty.parking) detailsText += `🚗 *Parking:* ${matchedProperty.parking}\n`;
            if (matchedProperty.furnishing) detailsText += `🪑 *Furnishing:* ${matchedProperty.furnishing}\n`;
            if (matchedProperty.age) detailsText += `📅 *Age:* ${matchedProperty.age}\n`;
            if (matchedProperty.facing) detailsText += `🧭 *Facing:* ${matchedProperty.facing}\n`;
            
            detailsText += `\n📝 *Description:*\n${matchedProperty.description || 'Contact us for details.'}\n`;
            detailsText += `\n_Interested? Type "inquiry ${matchedProperty.title}" to connect with our expert._`;
            detailsText += `\n\n🌐 *thanehome.com*`;

            if (matchedProperty.imageUrl) {
                await sock.sendMessage(sender, {
                    image: { url: matchedProperty.imageUrl },
                    caption: detailsText
                });
            } else {
                await sock.sendMessage(sender, { text: detailsText });
            }
            return;
        }

        // ========== 📩 STEP 1: START INQUIRY FLOW ==========
        if (text.startsWith("inquiry ") || text.startsWith("enquiry ") || text.startsWith("book ") || text.startsWith("visit ")) {
            const propertyQuery = text.replace("inquiry ", "").replace("enquiry ", "").replace("book ", "").replace("visit ", "").trim();
            const currentProperties = await getPropertiesFromApp();
            const matchedProperty = currentProperties.find(p => p.title.toLowerCase().includes(propertyQuery));

            if (!matchedProperty) {
                await sock.sendMessage(sender, {
                    text: `❌ Property *${propertyQuery}* not found.\n\nType *properties* to see available listings.\n🌐 Or visit *thanehome.com*`
                });
                return;
            }

            inquiryStates[sender] = { step: 'WAITING_FOR_DETAILS', property: matchedProperty };

            const captionText = `📩 *Site Visit Booking - TaneHome*\n\n`;
            captionText += `🏢 *Property:* ${matchedProperty.title}\n`;
            captionText += `📍 *Location:* ${matchedProperty.location}\n`;
            captionText += `💰 *Price:* ₹${matchedProperty.price}\n\n`;
            captionText += `Please reply with your:\n`;
            captionText += `• *Full Name*\n`;
            captionText += `• *Phone Number*\n`;
            captionText += `• *Budget (if flexible)*\n`;
            captionText += `• *Preferred visit date & time*\n\n`;
            captionText += `_Example: Rohit Sharma, 9876543210, Budget 55L, Saturday 11am_`;

            if (matchedProperty.imageUrl) {
                await sock.sendMessage(sender, {
                    image: { url: matchedProperty.imageUrl },
                    caption: captionText
                });
            } else {
                await sock.sendMessage(sender, { text: captionText });
            }
            return;
        }
        else if (text === "inquiry" || text === "enquiry" || text === "book" || text === "visit") {
            await sock.sendMessage(sender, {
                text: "📩 *How to book a site visit:*\n\nType: *inquiry [property name]*\n\nExample: *inquiry 3bhk flat thane*\n\n🌐 Or visit *thanehome.com* to browse & inquire."
            });
            return;
        }

        // ========== 🏠 SHOW ALL PROPERTIES ==========
        if (text.includes("property") || text.includes("properties") || text.includes("list") || text.includes("available") || text.includes("show") || text.includes("flat") || text.includes("house") || text.includes("bhk")) {
            const currentProperties = await getPropertiesFromApp();

            if (currentProperties.length === 0) {
                await sock.sendMessage(sender, {
                    text: "🚫 *No properties available right now.*\n\nNew listings are added daily on TaneHome.\n🌐 Visit *thanehome.com* for the latest updates!\n\n📊 Type *search [keyword]* to filter later."
                });
                return;
            }

            const forSale = currentProperties.filter(p => p.listingType === 'sale');
            const forRent = currentProperties.filter(p => p.listingType === 'rent');

            let propertyMessage = "🏢 *TANEHOME - LIVE PROPERTY LISTINGS* 🏠\n";
            propertyMessage += "────────────────────────────\n";

            if (forSale.length > 0) {
                propertyMessage += "\n🏷️ *FOR SALE:*\n";
                forSale.forEach(p => {
                    propertyMessage += `─────────────\n`;
                    propertyMessage += `🔸 *${p.title}*\n`;
                    propertyMessage += `📍 ${p.location}\n`;
                    propertyMessage += `💰 ₹${p.price} | 📐 ${p.area}\n`;
                    propertyMessage += `🛏️ ${p.bedrooms || '-'} BHK`;
                    if (p.floor) propertyMessage += ` | 🏗️ ${p.floor}`;
                    propertyMessage += `\n`;
                });
            }

            if (forRent.length > 0) {
                propertyMessage += "\n🏠 *FOR RENT:*\n";
                forRent.forEach(p => {
                    propertyMessage += `─────────────\n`;
                    propertyMessage += `🔸 *${p.title}*\n`;
                    propertyMessage += `📍 ${p.location}\n`;
                    propertyMessage += `💰 ₹${p.price}/month | 📐 ${p.area}\n`;
                    propertyMessage += `🛏️ ${p.bedrooms || '-'} BHK`;
                    if (p.furnishing) propertyMessage += ` | 🪑 ${p.furnishing}`;
                    propertyMessage += `\n`;
                });
            }

            propertyMessage += "\n────────────────────────────\n";
            propertyMessage += "📌 *details [name]* → Full info\n";
            propertyMessage += "📌 *inquiry [name]* → Book visit\n";
            propertyMessage += "📌 *search [keyword]* → Filter\n\n";
            propertyMessage += "🌐 *thanehome.com*";

            await sock.sendMessage(sender, { text: propertyMessage });

            // Send featured property image
            if (currentProperties[0]?.imageUrl) {
                await sock.sendMessage(sender, {
                    image: { url: currentProperties[0].imageUrl },
                    caption: `🌟 *Featured Listing - TaneHome*\n\n🏢 *${currentProperties[0].title}*\n💰 ₹${currentProperties[0].price}\n📍 ${currentProperties[0].location}\n📐 ${currentProperties[0].area}\n\n🌐 thanehome.com`
                });
            }
            return;
        }

        // ========== 🔎 SEARCH BY TYPE / LOCATION ==========
        if (text.startsWith("search ")) {
            const searchQuery = text.replace("search ", "").trim();
            const currentProperties = await getPropertiesFromApp();

            const results = currentProperties.filter(p =>
                p.title.toLowerCase().includes(searchQuery) ||
                p.location.toLowerCase().includes(searchQuery) ||
                p.type.toLowerCase().includes(searchQuery) ||
                (p.listingType && p.listingType.toLowerCase().includes(searchQuery)) ||
                (p.furnishing && p.furnishing.toLowerCase().includes(searchQuery)) ||
                (p.bedrooms && p.bedrooms.toLowerCase().includes(searchQuery))
            );

            if (results.length === 0) {
                await sock.sendMessage(sender, {
                    text: `🔍 No properties found for *${searchQuery}*.\n\nTry:\n• *search flat*\n• *search thane*\n• *search 2bhk*\n• *search rent*\n• *search furnished*\n• *search under 50 lakh*\n\n🌐 Browse all at *thanehome.com*`
                });
                return;
            }

            let searchMsg = `🔍 *TaneHome Search: "${searchQuery}"*\n`;
            searchMsg += `Found *${results.length}* properties\n`;
            searchMsg += "────────────────────────────\n\n";

            results.forEach(p => {
                const label = p.listingType === 'rent' ? '🏠 Rent' : '🏷️ Sale';
                searchMsg += `${label} | *${p.title}*\n`;
                searchMsg += `📍 ${p.location}\n`;
                searchMsg += `💰 ₹${p.price}`;
                if (p.listingType === 'rent') searchMsg += `/month`;
                searchMsg += ` | 📐 ${p.area}\n`;
                searchMsg += `🛏️ ${p.bedrooms || '-'} BHK`;
                if (p.furnishing) searchMsg += ` | 🪑 ${p.furnishing}`;
                searchMsg += `\n─────────────\n`;
            });

            searchMsg += "\n📌 *details [name]* → Full info\n";
            searchMsg += "📌 *inquiry [name]* → Book visit\n";
            searchMsg += "📌 *properties* → See all\n\n";
            searchMsg += "🌐 thanehome.com";

            await sock.sendMessage(sender, { text: searchMsg });
            return;
        }
        else if (text === "search") {
            await sock.sendMessage(sender, {
                text: "🔍 *TaneHome Smart Search:*\n\nType: *search [keyword]*\n\nExamples:\n• *search flat* - All flats\n• *search thane* - Thane location\n• *search 2bhk* - 2 BHK properties\n• *search rent* - Rental listings\n• *search furnished* - Furnished homes\n• *search plot* - Plots & land\n• *search commercial* - Shops/Offices\n\n🌐 Full search at *thanehome.com*"
            });
            return;
        }

        // ========== 📞 CONTACT ==========
        if (text.includes("contact") || text.includes("call") || text.includes("phone") || text.includes("number") || text.includes("whatsapp")) {
            await sock.sendMessage(sender, {
                text: `📞 *Contact TaneHome:*\n\n`;
                text += `🌐 *Website:* thanehome.com\n`;
                text += `📧 *Email:* info@thanehome.com\n`;
                text += `💬 *WhatsApp:* This chat (24/7)\n`;
                text += `🕐 *Office Hours:* Mon-Sat, 10AM - 7PM\n\n`;
                text += `_Our property experts are ready to help you find your dream home!_`;
            });
            return;
        }

        // ========== 💰 BUDGET / EMI HELP ==========
        if (text.includes("budget") || text.includes("emi") || text.includes("loan") || text.includes("finance") || text.includes("home loan")) {
            await sock.sendMessage(sender, {
                text: `💰 *TaneHome - Budget & Finance Guide*\n\n`;
                text += `📊 *Home Loan EMI Calculator:*\n\n`;
                text += `🔹 ₹20 Lakh @ 8.5% (20yr) → ~₹17,356/mo\n`;
                text += `🔹 ₹30 Lakh @ 8.5% (20yr) → ~₹26,034/mo\n`;
                text += `🔹 ₹50 Lakh @ 8.5% (20yr) → ~₹43,391/mo\n`;
                text += `🔹 ₹75 Lakh @ 8.5% (20yr) → ~₹65,086/mo\n`;
                text += `🔹 ₹1 Cr @ 8.5% (20yr) → ~₹86,782/mo\n\n`;
                text += `🏠 *Thane Property Budget Guide:*\n`;
                text += `• ₹20-40L → 1-2 BHK (Kalwa/Mumbra)\n`;
                text += `• ₹40-70L → 2-3 BHK (Ghodbunder/Waghbil)\n`;
                text += `• ₹70L-1.2Cr → 3 BHK Premium (Thane West)\n`;
                text += `• ₹1.2Cr+ → Luxury/Villa (Hiranandani/Majiwada)\n\n`;
                text += `📞 _TaneHome helps with bank tie-ups & pre-approved loans!_\n`;
                text += `🌐 thanehome.com`;
            });
            return;
        }

        // ========== 🏢 SELL / LIST PROPERTY ==========
        if (text.includes("sell") || text.includes("list property") || text.includes("post property") || text.includes("advertise")) {
            await sock.sendMessage(sender, {
                text: `🏢 *List Your Property on TaneHome!*\n\n`;
                text += `Get maximum visibility for your property.\n\n`;
                text += `📋 *To list, send us:*\n`;
                text += `• Property Type (Flat/House/Plot/Shop)\n`;
                text += `• Location (Area, Thane)\n`;
                text += `• Area (sq ft)\n`;
                text += `• Price Expectation\n`;
                text += `• Bedrooms & Bathrooms\n`;
                text += `• Furnishing Status\n`;
                text += `• Floor & Parking\n`;
                text += `• Your Name & Phone\n`;
                text += `• Photos (if available)\n\n`;
                text += `✅ *Why TaneHome?*\n`;
                text += `• 1000+ active buyers on WhatsApp\n`;
                text += `• Website listing on thanehome.com\n`;
                text += `• Professional photos (optional)\n`;
                text += `• Verified buyer connections\n`;
                text += `• No brokerage for buyers!\n\n`;
                text += `_Our team will verify & list within 24 hours!_`;
            });
            return;
        }

        // ========== 📍 ABOUT THANE ==========
        if (text.includes("thane") || text.includes("area") || text.includes("location") || text.includes("locality")) {
            await sock.sendMessage(sender, {
                text: `📍 *TaneHome - Top Thane Localities:*\n\n`;
                text += `⭐ *Premium Areas:*\n`;
                text += `• Hiranandani Estate\n`;
                text += `• Brahmand\n`;
                text += `• Majiwada\n`;
                text += `• Kapurbawdi\n`;
                text += `• Waghbil\n\n`;
                text += `🏢 *Mid-Range Areas:*\n`;
                text += `• Ghodbunder Road\n`;
                text += `• Manpada\n`;
                text += `• Kasarvadavali\n`;
                text += `• Patlipada\n\n`;
                text += `🏠 *Affordable Areas:*\n`;
                text += `• Kalwa\n`;
                text += `• Mumbra\n`;
                text += `• Kalyan Road\n`;
                text += `• Diva\n\n`;
                text += `_Type "search [area name]" to find properties!_\n`;
                text += `🌐 thanehome.com`;
            });
            return;
        }

        // ========== 👋 GREETINGS ==========
        if (text.includes("hi") || text.includes("hello") || text.includes("hey") || text.includes("namaste") || text.includes("good morning") || text.includes("good evening")) {
            await sock.sendMessage(sender, {
                text: `👋 *Welcome to TaneHome!* 🏠\n\n`;
                text += `Thane's Trusted Real Estate Platform\n`;
                text += `🌐 thanehome.com\n\n`;
                text += `How can I help you today?\n\n`;
                text += `🏠 *properties* - See all listings\n`;
                text += `🔍 *search [keyword]* - Find property\n`;
                text += `📋 *details [name]* - Full property info\n`;
                text += `📩 *inquiry [name]* - Book site visit\n`;
                text += `📍 *thane* - Top localities guide\n`;
                text += `💰 *budget* - EMI & loan help\n`;
                text += `🏢 *sell* - List your property\n`;
                text += `📞 *contact* - Call us\n\n`;
                text += `_Example: type "properties" to start!_`;
            });
            return;
        }

        // ========== ❓ HELP ==========
        if (text.includes("help") || text.includes("commands") || text.includes("options") || text.includes("menu")) {
            await sock.sendMessage(sender, {
                text: `📋 *TANEHOME COMMANDS:*\n\n`;
                text += `🏠 *properties* - All listings\n`;
                text += `🔍 *search [keyword]* - Find property\n`;
                text += `📋 *details [name]* - Full details\n`;
                text += `📩 *inquiry [name]* - Book visit\n`;
                text += `📍 *thane* - Locality guide\n`;
                text += `💰 *budget* - EMI calculator\n`;
                text += `🏢 *sell* - List your property\n`;
                text += `📞 *contact* - Contact details\n`;
                text += `❓ *help* - This menu\n\n`;
                text += `_💬 You can also type naturally: "3bhk in ghodbunder" or "flat under 50 lakh"_\n\n`;
                text += `🌐 thanehome.com`;
            });
            return;
        }

        // ========== 🙏 THANK YOU ==========
        if (text.includes("thank") || text.includes("thanks") || text.includes("dhanyavad")) {
            await sock.sendMessage(sender, {
                text: `🙏 *You're welcome!*\n\n`;
                text += `TaneHome is always here to help you find your dream home in Thane.\n\n`;
                text += `🌐 thanehome.com\n`;
                text += `💬 Anytime you need help, just message!`
            });
            return;
        }

        // ========== 🚫 DEFAULT REPLY ==========
        await sock.sendMessage(sender, {
            text: `🤔 I didn't understand that.\n\n`;
            text += `Try these:\n`;
            text += `• *properties* - See listings\n`;
            text += `• *search [keyword]* - Find property\n`;
            text += `• *help* - All commands\n\n`;
            text += `_Example: "search 2bhk flat"_\n\n`;
            text += `🌐 Or visit *thanehome.com*`;
        });
    });
}

startBot().catch(err => console.log("Error: " + err));
