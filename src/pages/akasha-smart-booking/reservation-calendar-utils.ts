export function addCalendarDays(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function getReservationCalendarRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const weekday = new Date(Date.UTC(year, monthNumber - 1, 1, 12)).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  const from = addCalendarDays(firstDay, -mondayOffset);
  const until = addCalendarDays(from, 41);
  return { from, until };
}

export function shiftReservationCalendarMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1, 12)));
}
