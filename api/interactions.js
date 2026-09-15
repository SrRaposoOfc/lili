const nacl = require('tweetnacl');
const { resetCounters, RESET_CUSTOM_ID, EPHEMERAL } = require('./_discord.js');

const PUBLIC_KEY = process.env.PUBLIC_KEY;

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

function ephemeralMessage(content, components) {
  const data = { flags: EPHEMERAL };
  if (content) data.content = content;
  if (components) data.components = components;
  return { type: 4, data };
}

function resetConfirmation() {
  return ephemeralMessage(
    '**🔄 Resetar contador?**\nTem certeza que quer zerar o contador de visitas? Essa ação não pode ser desfeita.',
    [
      {
        type: 1,
        components: [
          { type: 2, style: 4, custom_id: 'confirm_reset', label: 'Sim, resetar' },
          { type: 2, style: 2, custom_id: 'cancel_reset', label: 'Cancelar' },
        ],
      },
    ]
  );
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
    const cid = body.data && body.data.custom_id;

    if (cid === RESET_CUSTOM_ID) {
      res.status(200).json(resetConfirmation());
      return;
    }

    if (cid === 'confirm_reset') {
      let r;
      try {
        r = await Promise.race([
          resetCounters(),
          new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), 2500)),
        ]);
      } catch (e) {
        r = { ok: false, error: String(e.message) };
      }
      if (r.ok) {
        res.status(200).json(ephemeralMessage('✅ Contador resetado com sucesso!'));
      } else {
        res.status(200).json(ephemeralMessage('⚠️ Não consegui resetar agora. Tenta de novo.'));
      }
      return;
    }

    if (cid === 'cancel_reset') {
      res.status(200).json(ephemeralMessage('Cancelado. Nenhum valor foi alterado.'));
      return;
    }
  }

  res.status(200).json({ type: 1 });
};