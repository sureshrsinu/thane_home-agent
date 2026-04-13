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
            type: data[key].type,           // flat, house, plot, commercial
            price: data[key].price,
            location: data[key].location,
            area: data[key].area,           // sq ft / sq yards
            bedrooms: data[key].bedrooms,
            bathrooms: data[key].bathrooms,
            imageUrl: data[key].imageUrl,
            description: data[key].description,
            ownerName: data[key].ownerName,
            ownerPhone: data[key].ownerPhone,
            listingType: data[key].listingType // sale / rent
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
        browser: ["RealEstate", "Bot", "1"]
    });

    // ========== 🔌 CONNECTION EVENTS ==========
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.clear();
            console.log('\n==================================================');
            console.log('⚠️ QR CODE TOO BIG? CLICK "View raw logs" IN TOP RIGHT!');
            console.log('==================================================\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') console.log('✅ REAL ESTATE AI BOT IS ONLINE!');
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

        console.log(`📩 Query: ${text}`);

        // ========== 📋 STEP 3: SAVE INQUIRY TO FIREBASE ==========
        if (inquiryStates[sender]?.step === 'WAITING_FOR_DETAILS') {
            const customerDetails = text;
            const property = inquiryStates[sender].property;
            const customerWaNumber = sender.split('@')[0];

            const realEstateInquiry = {
                userId: "whatsapp_" + customerWaNumber,
                customerPhone: customerWaNumber,
                customerDetails: customerDetails, // Name, Phone, Budget, Visit Time
                propertyId: property.id,
                propertyTitle: property.title,
                propertyType: property.type,
                propertyPrice: property.price,
                propertyLocation: property.location,
                listingType: property.listingType,
                status: "New Inquiry",
                timestamp: new Date().toISOString()
            };

            // Save inquiry to Firebase
            try {
                await fetch(`${FIREBASE_URL}/inquiries.json`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(realEstateInquiry)
                });
            } catch (error) {
                console.log("Firebase Error: ", error);
            }

            await sock.sendMessage(sender, {
                text: `✅ *Inquiry Submitted Successfully!*\n\n🏠 *Property:* ${property.title}\n📍 *Location:* ${property.location}\n💰 *Price:* ₹${property.price}\n\n📋 *Your Details:* ${customerDetails}\n\n🙏 Thank you for your interest! Our real estate agent will contact you within 30 minutes.\n\n📞 *Helpline:* For urgent queries, call us directly.`
            });

            delete inquiryStates[sender];
            return;
        }

        // ========== 🔍 STEP 2: PROPERTY DETAILS + INQUIRY START ==========
        if (text.startsWith("details ") || text.startsWith("info ")) {
            const propertyQuery = text.replace("details ", "").replace("info ", "").trim();
            const currentProperties = await getPropertiesFromApp();
            const matchedProperty = currentProperties.find(p => p.title.toLowerCase().includes(propertyQuery));

            if (!matchedProperty) {
                await sock.sendMessage(sender, {
                    text: `❌ Sorry, we couldn't find *${propertyQuery}*.\n\nType *properties* to see all available listings.`
                });
                return;
            }

            const listingLabel = matchedProperty.listingType === 'rent' ? '🏠 FOR RENT' : '🏷️ FOR SALE';
            const detailsText = `${listingLabel}\n\n🏢 *${matchedProperty.title}*\n📍 *Location:* ${matchedProperty.location}\n💰 *Price:* ₹${matchedProperty.price}\n📐 *Area:* ${matchedProperty.area}\n🛏️ *Bedrooms:* ${matchedProperty.bedrooms || 'N/A'}\n🚿 *Bathrooms:* ${matchedProperty.bathrooms || 'N/A'}\n📄 *Type:* ${matchedProperty.type}\n\n📝 *Description:*\n${matchedProperty.description || 'Contact for details.'}\n\n_Interested? Type "inquiry ${matchedProperty.title}" to connect with our agent._`;

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
        if (text.startsWith("inquiry ")) {
            const propertyQuery = text.replace("inquiry ", "").trim();
            const currentProperties = await getPropertiesFromApp();
            const matchedProperty = currentProperties.find(p => p.title.toLowerCase().includes(propertyQuery));

            if (!matchedProperty) {
                await sock.sendMessage(sender, {
                    text: `❌ Property *${propertyQuery}* not found.\n\nType *properties* to see available listings.`
                });
                return;
            }

            inquiryStates[sender] = { step: 'WAITING_FOR_DETAILS', property: matchedProperty };

            const captionText = `📩 *Inquiry Started!*\n\n🏢 *Property:* ${matchedProperty.title}\n📍 *Location:* ${matchedProperty.location}\n💰 *Price:* ₹${matchedProperty.price}\n\nPlease reply with your:\n• *Full Name*\n• *Phone Number*\n• *Budget (if flexible)*\n• *Preferred visit time*\n\n_Example: Rohit Kumar, 9876543210, Budget 50L, Visit Saturday 11am_`;

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
        else if (text === "inquiry") {
            await sock.sendMessage(sender, {
                text: "📩 *How to inquire:*\n\nType: *inquiry [property name]*\n\nExample: *inquiry 3bhk flat vasai*"
            });
            return;
        }

        // ========== 🏠 SHOW ALL PROPERTIES ==========
        if (text.includes("property") || text.includes("properties") || text.includes("list") || text.includes("available") || text.includes("show")) {
            const currentProperties = await getPropertiesFromApp();

            if (currentProperties.length === 0) {
                await sock.sendMessage(sender, {
                    text: "🚫 *No properties available right now.*\n\nNew listings are added daily. Please check back soon!"
                });
                return;
            }

            // Separate sale and rent
            const forSale = currentProperties.filter(p => p.listingType === 'sale');
            const forRent = currentProperties.filter(p => p.listingType === 'rent');

            let propertyMessage = "🏠 *LIVE PROPERTY LISTINGS* 🏢\n\n";

            if (forSale.length > 0) {
                propertyMessage += "🏷️ *FOR SALE:*\n";
                forSale.forEach(p => {
                    propertyMessage += `─────────────\n🔸 *${p.title}*\n📍 ${p.location}\n💰 ₹${p.price} | 📐 ${p.area}\n🛏️ ${p.bedrooms || '-'} BHK\n`;
                });
            }

            if (forRent.length > 0) {
                propertyMessage += "\n🏠 *FOR RENT:*\n";
                forRent.forEach(p => {
                    propertyMessage += `─────────────\n🔸 *${p.title}*\n📍 ${p.location}\n💰 ₹${p.price}/month | 📐 ${p.area}\n🛏️ ${p.bedrooms || '-'} BHK\n`;
                });
            }

            propertyMessage += "\n\n_📌 For details: type "details [property name]"_\n_📌 To inquire: type "inquiry [property name]"_";

            await sock.sendMessage(sender, { text: propertyMessage });

            // Send first property image as preview
            if (currentProperties[0]?.imageUrl) {
                await sock.sendMessage(sender, {
                    image: { url: currentProperties[0].imageUrl },
                    caption: `🌟 *Featured:* ${currentProperties[0].title}\n💰 ₹${currentProperties[0].price}\n📍 ${currentProperties[0].location}`
                });
            }
            return;
        }

        // ========== 🔎 SEARCH BY TYPE ==========
        if (text.startsWith("search ")) {
            const searchQuery = text.replace("search ", "").trim();
            const currentProperties = await getPropertiesFromApp();

            const results = currentProperties.filter(p =>
                p.title.toLowerCase().includes(searchQuery) ||
                p.location.toLowerCase().includes(searchQuery) ||
                p.type.toLowerCase().includes(searchQuery) ||
                (p.listingType && p.listingType.toLowerCase().includes(searchQuery))
            );

            if (results.length === 0) {
                await sock.sendMessage(sender, {
                    text: `🔍 No properties found for *${searchQuery}*.\n\nTry: *search flat*, *search vasai*, *search rent*`
                });
                return;
            }

            let searchMsg = `🔍 *Search Results for "${searchQuery}":*\n\n`;
            results.forEach(p => {
                const label = p.listingType === 'rent' ? '🏠 Rent' : '🏷️ Sale';
                searchMsg += `─────────────\n${label} | *${p.title}*\n📍 ${p.location}\n💰 ₹${p.price}\n📐 ${p.area} | 🛏️ ${p.bedrooms || '-'} BHK\n`;
            });
            searchMsg += "\n_📌 Type "details [name]" for info_\n_📌 Type "inquiry [name]" to book visit_";

            await sock.sendMessage(sender, { text: searchMsg });
            return;
        }
        else if (text === "search") {
            await sock.sendMessage(sender, {
                text: "🔍 *How to search:*\n\nType: *search [keyword]*\n\nExamples:\n• *search flat*\n• *search vasai*\n• *search 2bhk*\n• *search rent*\n• *search plot*"
            });
            return;
        }

        // ========== 📞 CONTACT ==========
        if (text.includes("contact") || text.includes("call") || text.includes("phone") || text.includes("number")) {
            await sock.sendMessage(sender, {
                text: "📞 *Contact Us:*\n\n• *WhatsApp:* This chat\n• *Email:* info@yourrealestate.com\n• *Office:* Mon-Sat, 10AM - 7PM\n\n📞 *For urgent calls:* [Add your number here]"
            });
            return;
        }

        // ========== 💰 PRICING / BUDGET HELP ==========
        if (text.includes("budget") || text.includes("emi") || text.includes("loan") || text.includes("finance")) {
            await sock.sendMessage(sender, {
                text: "💰 *Budget & Finance Help:*\n\n🏠 *Home Loan EMI Calculator:*\nFor ₹50 Lakh loan @ 8.5% for 20 years\nEMI ≈ ₹43,391/month\n\n📊 *Rough Budget Guide:*\n• ₹20-40L: 1-2 BHK in Suburbs\n• ₹40-80L: 2-3 BHK in Mid Areas\n• ₹80L-1.5Cr: 3 BHK Premium\n• ₹1.5Cr+: Luxury / Villa\n\n📞 _Contact us for bank tie-up & pre-approved loans!_"
            });
            return;
        }

        // ========== 🛒 SELL PROPERTY ==========
        if (text.includes("sell") || text.includes("list property") || text.includes("post property")) {
            await sock.sendMessage(sender, {
                text: "🏢 *Want to Sell/Rent Your Property?*\n\nWe can list your property on our platform!\n\nTo proceed, send us:\n• Property Type (Flat/House/Plot/Shop)\n• Location\n• Area (sq ft)\n• Price Expectation\n• Your Name & Phone\n• Photos (if available)\n\n_Our team will verify and list within 24 hours!_"
            });
            return;
        }

        // ========== 👋 GREETINGS ==========
        if (text.includes("hi") || text.includes("hello") || text.includes("hey") || text.includes("namaste")) {
            await sock.sendMessage(sender, {
                text: "👋 *Welcome to Our Real Estate Services!*\n\nI'm your AI Property Assistant. How can I help you?\n\n🏠 *properties* - See all listings\n🔍 *search [keyword]* - Find specific property\n📋 *details [name]* - Get full property info\n📩 *inquiry [name]* - Book a site visit\n💰 *budget* - EMI & finance help\n🏢 *sell* - List your property\n📞 *contact* - Call us\n\n_Example: type "properties" to start!_"
            });
            return;
        }

        // ========== ❓ HELP ==========
        if (text.includes("help") || text.includes("commands") || text.includes("options")) {
            await sock.sendMessage(sender, {
                text: "📋 *AVAILABLE COMMANDS:*\n\n🏠 *properties* - View all listings\n🔍 *search [keyword]* - Search properties\n📋 *details [name]* - Full property details\n📩 *inquiry [name]* - Book site visit\n💰 *budget* - Loan/EMI info\n🏢 *sell* - List your property\n📞 *contact* - Contact details\n\n_💬 Just type naturally like "3bhk in vasai" or "flat under 50 lakh"!_"
            });
            return;
        }

        // ========== 🚫 DEFAULT REPLY ==========
        await sock.sendMessage(sender, {
            text: "🤔 I didn't understand that.\n\nType *properties* to see listings\nType *help* for all commands\nType *search [keyword]* to find specific property\n\n_Example: "search 2bhk flat"_"
        });
    });
}

startBot().catch(err => console.log("Error: " + err));
