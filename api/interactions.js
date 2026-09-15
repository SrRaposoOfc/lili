const nacl = require('tweetnacl');
const { resetCounters, RESET_CUSTOM_ID, V2_FLAG, EPHEMERAL } = require('./_discord.js');

const BASE = 'https://discord.com/api/v10';
const PUBLIC_KEY = process.env.PUBLIC_KEY;
const APP_ID = process.env.CLIENT_ID;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (!req || typeof req.on !== 'function') {
      resolve(Buffer.from(''));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isValidSignature(signature, timestamp, rawBuf) {
  try {
    return nacl.sign.detached.verify(
      Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBuf]),
      Buffer.from(signature, 'hex'),
      Buffer.from(PUBLIC_KEY, 'hex')
    );
  } catch (e) {
    return false;
  }
}

function textMessage(text) {
  return {
    flags: EPHEMERAL | V2_FLAG,
    components: [{ type: 10, content: text }],
  };
}

function resetConfirmation() {
  return {
    flags: EPHEMERAL | V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 10038562,
        components: [
          { type: 10, content: '**🔄 Resetar contador?**\nTem certeza que quer zerar o contador de visitas? Essa ação não pode ser desfeita.' },
          {
            type: 1,
            components: [
              { type: 2, style: 4, custom_id: 'confirm_reset', label: 'Sim, resetar' },
              { type: 2, style: 2, custom_id: 'cancel_reset', label: 'Cancelar' },
            ],
          },
        ],
      },
    ],
  };
}

async function sendFollowup(token, payload) {
  const res = await fetch(`${BASE}/webhooks/${APP_ID}/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

async function handleComponent(customId, token) {
  if (customId === RESET_CUSTOM_ID) {
    return sendFollowup(token, resetConfirmation());
  }
  if (customId === 'confirm_reset') {
    const r = await resetCounters();
    if (r.ok) {
      return sendFollowup(token, textMessage('✅ Contador resetado com sucesso!'));
    }
    return sendFollowup(token, textMessage('⚠️ Não consegui resetar agora. Tenta de novo.'));
  }
  if (customId === 'cancel_reset') {
    return sendFollowup(token, textMessage('Cancelado. Nenhum valor foi alterado.'));
  }
  return false;
}

module.exports = async function handler(req, res) {
  let rawBuf;
  try {
    rawBuf = await readRawBody(req);
  } catch (e) {
    res.status(400).json({ error: 'bad body' });
    return;
  }

  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];

  if (signature && timestamp) {
    if (!PUBLIC_KEY) {
      res.status(500).json({ error: 'PUBLIC_KEY not configured' });
      return;
    }
    if (!isValidSignature(signature, timestamp, rawBuf)) {
      res.status(401).json({ error: 'invalid signature' });
      return;
    }
  } else if (process.env.DISCORD_BYPASS !== '1') {
    res.status(401).json({ error: 'missing signature' });
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBuf.toString('utf8'));
  } catch (e) {
    res.status(400).json({ error: 'bad json' });
    return;
  }

  if (body.type === 1) {
    res.status(200).json({ type: 1 });
    return;
  }

  if (body.type === 3) {
    res.status(200).json({ type: 5 });
    const token = body.token;
    const cid = body.data && body.data.custom_id;
    if (token && cid) {
      try {
        await handleComponent(cid, token);
      } catch (e) {
        try {
          await sendFollowup(token, textMessage('❌ Algo deu errado: ' + String(e.message)));
        } catch (e2) {}
      }
    }
    return;
  }

  res.status(200).json({ type: 1 });
};