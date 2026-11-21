function fieldMatches(field, value, min, max) {
  for (const part of String(field).split(',')) {
    const [range, stepText] = part.split('/');
    const step = Math.max(1, Number(stepText || 1));
    let start = min, end = max;
    if (range !== '*') {
      if (range.includes('-')) [start, end] = range.split('-').map(Number);
      else start = end = Number(range);
    }
    if (value >= start && value <= end && (value - start) % step === 0) return true;
  }
  return false;
}

export function cronMatches(expression, date = new Date()) {
  const fields = String(expression || '').trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('cron 必须是五字段表达式');
  const values = [date.getUTCMinutes(), date.getUTCHours(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay()];
  return fields.every((field, index) => fieldMatches(field, values[index], index === 0 ? 0 : 1, index === 4 ? 6 : index === 0 ? 59 : index === 1 ? 23 : index === 2 ? 31 : 12));
}

export function nextCronAt(expression, from = new Date()) {
  const value = new Date(from);
  value.setUTCSeconds(0, 0);
  value.setUTCMinutes(value.getUTCMinutes() + 1);
  for (let i = 0; i < 525600; i++) {
    if (cronMatches(expression, value)) return value;
    value.setUTCMinutes(value.getUTCMinutes() + 1);
  }
  throw new Error('cron 一年内没有可运行时间');
}