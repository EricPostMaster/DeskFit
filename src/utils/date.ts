export function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getWeekday(): string {
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()];
}
