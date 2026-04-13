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
