const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const pino = require('pino')
const qrcode = require('qrcode-terminal')
const config = require('./config')

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ logger: pino({ level: 'silent' }), auth: state, printQRInTerminal: true })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) qrcode.generate(qr, { small: true })
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      if (shouldReconnect) start()
    } else if (connection === 'open') {
      console.log('MADARA-PROTECT CONNECTED ✅')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return
    const jid = m.key.remoteJid
    const isGroup = jid.endsWith('@g.us')
    if (!isGroup) return

    const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || ''
    const metadata = await sock.groupMetadata(jid)
    const isAdmin = metadata.participants.find(p => p.id === m.key.participant)?.admin
    const isOwner = m.key.participant?.startsWith(config.owner)

    if (isAdmin || isOwner) return

    const hasLink = /https?:\/\/|wa\.me\/|chat\.whatsapp\.com\//i.test(text)
    if (config.antilink && hasLink && !config.allowedLinks.some(l => text.includes(l))) {
      await sock.sendMessage(jid, { delete: m.key })
      await sock.sendMessage(jid, { text: `⚠️ @${m.key.participant.split('@')[0]} الروابط ممنوعة!`, mentions: [m.key.participant] })
      return
    }

    const hasVCard = !!m.message.contactMessage || !!m.message.contactsArrayMessage || text.includes('BEGIN:VCARD')
    if (config.antivcard && hasVCard) {
      await sock.sendMessage(jid, { delete: m.key })
      await sock.sendMessage(jid, { text: `⚠️ @${m.key.participant.split('@')[0]} إرسال جهات الاتصال ممنوع!`, mentions: [m.key.participant] })
    }
  })
}
start()
