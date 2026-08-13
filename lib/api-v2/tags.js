const crypto = require('crypto');
const { getRequestIdentity, getSupabaseAdmin } = require('../server-supabase');
const store = require('../shared-store');
const { sendError, methodNotAllowed } = require('./_response');

module.exports = async function handler(req, res) {
  try {
    const identity = await getRequestIdentity(req);
    const supabase = getSupabaseAdmin();
    if (req.method === 'POST') {
      const name = String(req.body?.name || '').trim().slice(0, 24);
      if (!name) { const error = new Error('标签名称不能为空'); error.status = 400; throw error; }
      let tag;
      if (supabase) {
        const result = await supabase.from('tags').insert({ id: crypto.randomUUID(), space_id: identity.spaceId, name, created_by: identity.user.id }).select().single(); if (result.error) throw result.error; tag = result.data;
      } else {
        const meta = await store.getMeta(); tag = { id: crypto.randomUUID(), name }; meta.tags = [...(meta.tags || []), tag]; await store.saveMeta(meta);
      }
      return res.status(201).json(tag);
    }
    if (req.method === 'DELETE') {
      if (supabase) { const result = await supabase.from('tags').delete().eq('id', req.query.id).eq('space_id', identity.spaceId); if (result.error) throw result.error; }
      else { const meta = await store.getMeta(); meta.tags = (meta.tags || []).filter((tag) => tag.id !== req.query.id); await store.saveMeta(meta); }
      return res.status(200).json({ success: true });
    }
    return methodNotAllowed(res, ['POST', 'DELETE']);
  } catch (error) { return sendError(res, error); }
};
