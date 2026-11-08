/* Read-only recent movement review for the canonical Staff page.
 * This is a READ-ONLY similarity warning, never an attempt-status or idempotency contract.
 * Caller must freeze `records` first and pass an isCurrent guard bound to that exact batch.
 */
async function staffRecentMovementReview({ mode, records, scope, isCurrent, client, confirmFn, limit = 50 }) {
  const modes = new Set(['opening', 'taking', 'returning', 'transfer']);
  const allowed = new Set(Array.isArray(scope?.allowedBarIds) ? scope.allowedBarIds.map(String) : []);
  if (!modes.has(mode) || !Array.isArray(records) || !records.length || !scope?.venueId || !scope?.nightId ||
      !allowed.size || typeof isCurrent !== 'function' || !client || !Number.isInteger(limit) || limit < 1 || limit > 100)
    return { outcome: 'invalid_scope', matches: [], incomplete: true };
  if (records.some(row => !row || String(row.venue_id) !== String(scope.venueId) ||
      String(row.night_id) !== String(scope.nightId) || !allowed.has(String(row.bar_id)) ||
      (mode === 'transfer' && !allowed.has(String(row.destination_bar_id)))))
    return { outcome: 'invalid_scope', matches: [], incomplete: true };
  if (!isCurrent()) return { outcome: 'stale', matches: [], incomplete: true };
  const sourceBars = [...new Set(records.map(row => String(row.bar_id)))].sort();
  const fields = 'id,client_event_id,created_at,venue_id,night_id,bar_id,destination_bar_id,item_id,qty,action,status,notes,items(name),bars:bars!events_bar_id_fkey(name),destination_bar:bars!events_destination_bar_id_fkey(name)';
  let query = client.from('events').select(fields)
    .eq('venue_id', scope.venueId).eq('night_id', scope.nightId).in('bar_id', sourceBars);
  if (mode === 'opening') query = query.eq('action', 'DELIVERED').like('notes', 'Opening Stock — Par Wizard%');
  else {
    query = query.eq('status', 'PENDING');
    query = mode === 'taking' ? query.in('action', ['DELIVERED', 'ADJUSTMENT'])
      : query.eq('action', mode === 'returning' ? 'RETURNED' : 'TRANSFER');
  }
  let data, error;
  try {
    ({ data, error } = await query.order('created_at', { ascending: false })
      .order('id', { ascending: false }).limit(limit + 1));
  } catch (_) {
    if (!isCurrent()) return { outcome: 'stale', matches: [], incomplete: true };
    return { outcome: 'unavailable', matches: [], incomplete: true };
  }
  if (!isCurrent()) return { outcome: 'stale', matches: [], incomplete: true };
  if (error || !Array.isArray(data) || data.some(row => !row ||
      String(row.venue_id) !== String(scope.venueId) || String(row.night_id) !== String(scope.nightId) ||
      !sourceBars.includes(String(row.bar_id)) || !allowed.has(String(row.bar_id))))
    return { outcome: 'unavailable', matches: [], incomplete: true };
  const incomplete = data.length > limit;
  const candidates = data.slice(0, limit);
  const attemptedIds = new Set(records.map(row => String(row.client_event_id || '')).filter(Boolean));
  const exact = candidates.filter(row => attemptedIds.has(String(row.client_event_id || '')));
  if (exact.length) return { outcome: 'identified_attempt', matches: exact.map(staffRecentMovementProjection), incomplete };
  const matches = candidates.filter(row => mode === 'opening'
    ? row.action === 'DELIVERED' && String(row.notes || '').startsWith('Opening Stock — Par Wizard') &&
      records.some(record => String(record.bar_id) === String(row.bar_id))
    : row.status === 'PENDING' && records.some(record =>
      String(record.bar_id) === String(row.bar_id) && String(record.item_id) === String(row.item_id) &&
      String(record.action) === String(row.action) && Number(record.qty) === Number(row.qty) &&
      (mode !== 'transfer' || String(record.destination_bar_id) === String(row.destination_bar_id))));
  const projected = matches.map(staffRecentMovementProjection);
  if (!projected.length && incomplete) {
    const message = `Only the latest ${limit} scoped movement rows were checked. Older rows may include similar work. ` +
      'Continue only if this is a NEW intentional operation.\n\nStart this new operation?';
    if (typeof confirmFn !== 'function') return { outcome: 'needs_confirmation', matches: [], incomplete, message };
    if (!isCurrent()) return { outcome: 'stale', matches: [], incomplete: true };
    const confirmed = confirmFn(message) === true;
    if (!isCurrent()) return { outcome: 'stale', matches: [], incomplete: true };
    return { outcome: confirmed ? 'proceed' : 'cancel', matches: [], incomplete, confirmedNewWork: confirmed };
  }
  if (!projected.length) return { outcome: 'proceed', matches: [], incomplete };
  const intro = mode === 'opening'
    ? 'Prior Opening rows exist for this Night and Bar. Continue only if this is a NEW intentional Opening correction.'
    : 'A recent PENDING movement resembles this draft. Continue only if this is NEW intentional work.';
  const lines = projected.slice(0, 5).map(row =>
    `${row.when} · ${row.bar}${row.destination ? ' → ' + row.destination : ''} · ${row.item} · ${row.action} ${row.qty} · ${row.status} · ${row.id}`);
  const message = `${intro}\n${lines.join('\n')}${projected.length > 5 ? `\n…and ${projected.length - 5} more shown matches` : ''}` +
    `${incomplete ? `\nOnly the latest ${limit} scoped rows were checked; older rows may exist.` : ''}\n\nStart this new operation?`;
  if (typeof confirmFn !== 'function') return { outcome: 'needs_confirmation', matches: projected, incomplete, message };
  if (!isCurrent()) return { outcome: 'stale', matches: [], incomplete: true };
  const confirmed = confirmFn(message) === true;
  if (!isCurrent()) return { outcome: 'stale', matches: [], incomplete: true };
  return { outcome: confirmed ? 'proceed' : 'cancel', matches: projected, incomplete, confirmedNewWork: confirmed };
}
function staffRecentMovementProjection(row) {
  const date = Date.parse(String(row.created_at || ''));
  return {
    id: String(row.id || 'reference unavailable'),
    when: Number.isFinite(date) ? new Date(date).toLocaleString() : 'time unavailable',
    bar: String(row.bars?.name || row.bar_id || 'Bar unavailable'),
    destination: String(row.destination_bar?.name || row.destination_bar_id || ''),
    item: String(row.items?.name || row.item_id || 'Item unavailable'),
    action: String(row.action || 'ACTION'), qty: Number(row.qty), status: String(row.status || 'UNKNOWN')
  };
}
