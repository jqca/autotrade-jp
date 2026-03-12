/**
 * 日本の祝日・東証休業日判定モジュール
 * 対応範囲: 1980〜2099年
 */

const holidayCache = new Map<number, Set<string>>();

function dayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function nthMonday(year: number, month: number, n: number): number {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const date = new Date(Date.UTC(year, month - 1, d));
    if (date.getUTCMonth() !== month - 1) break;
    if (date.getUTCDay() === 1) {
      count++;
      if (count === n) return d;
    }
  }
  return -1;
}

function springEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function computeJpHolidays(year: number): Set<string> {
  const holidays = new Set<string>();

  const add = (month: number, day: number) => {
    if (day > 0) holidays.add(toDateStr(year, month, day));
  };

  add(1, 1);
  add(1, nthMonday(year, 1, 2));
  add(2, 11);
  add(2, 23);
  add(3, springEquinoxDay(year));
  add(4, 29);
  add(5, 3);
  add(5, 4);
  add(5, 5);
  add(7, nthMonday(year, 7, 3));
  add(8, 11);
  add(9, nthMonday(year, 9, 3));
  add(9, autumnEquinoxDay(year));
  add(10, nthMonday(year, 10, 2));
  add(11, 3);
  add(11, 23);

  addCitizensHolidays(holidays, year);
  addSubstituteHolidays(holidays, year);

  return holidays;
}

function addCitizensHolidays(holidays: Set<string>, year: number): void {
  for (let month = 1; month <= 12; month++) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 2; day < daysInMonth; day++) {
      const dow = dayOfWeek(year, month, day);
      if (dow === 0 || dow === 6) continue;
      const curr = toDateStr(year, month, day);
      if (holidays.has(curr)) continue;
      const prev = toDateStr(year, month, day - 1);
      const next = toDateStr(year, month, day + 1);
      if (holidays.has(prev) && holidays.has(next)) {
        holidays.add(curr);
      }
    }
  }
}

function addSubstituteHolidays(holidays: Set<string>, year: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    const toAdd = new Set<string>();
    for (const dateStr of holidays) {
      const d = new Date(dateStr + "T00:00:00Z");
      if (d.getUTCDay() !== 0) continue;
      let candidate = new Date(d);
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      while (
        holidays.has(candidate.toISOString().slice(0, 10)) ||
        toAdd.has(candidate.toISOString().slice(0, 10)) ||
        candidate.getUTCDay() === 6
      ) {
        candidate.setUTCDate(candidate.getUTCDate() + 1);
      }
      const s = candidate.toISOString().slice(0, 10);
      if (!holidays.has(s)) toAdd.add(s);
    }
    for (const s of toAdd) {
      holidays.add(s);
      changed = true;
    }
  }
}

export function getJpHolidays(year: number): Set<string> {
  if (!holidayCache.has(year)) {
    holidayCache.set(year, computeJpHolidays(year));
  }
  return holidayCache.get(year)!;
}

export function isJpHoliday(jstDate: Date): boolean {
  const year = jstDate.getUTCFullYear();
  const dateStr = jstDate.toISOString().slice(0, 10);
  return getJpHolidays(year).has(dateStr);
}

/**
 * 東証の取引日かどうか判定（JST基準のDateオブジェクトを渡す）
 * 休場日: 土日・祝日・年末年始（12/31、1/2、1/3）
 */
export function isJpTradingDay(utcNow: Date): boolean {
  const jst = new Date(utcNow.getTime() + 9 * 3600 * 1000);
  const dow = jst.getUTCDay();
  if (dow === 0 || dow === 6) return false;

  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  if (month === 12 && day === 31) return false;
  if (month === 1 && (day === 2 || day === 3)) return false;

  return !isJpHoliday(jst);
}

/**
 * 東証の取引時間内かどうか判定（UTC DateオブジェクトをJSTに変換して判定）
 * 取引時間: 9:00〜15:30 JST（2024年11月以降、昼休み廃止）
 */
export function isJpTradingHours(utcNow: Date): boolean {
  if (!isJpTradingDay(utcNow)) return false;
  const jst = new Date(utcNow.getTime() + 9 * 3600 * 1000);
  const tod = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  return tod >= 9 * 60 && tod <= 15 * 60 + 30;
}

/**
 * 直近N日分の祝日リストを返す（UI表示用）
 */
export function getUpcomingHolidays(utcNow: Date, days = 60): Array<{ date: string; name: string }> {
  const HOLIDAY_NAMES: Record<string, string> = {};
  const results: Array<{ date: string; name: string }> = [];

  const jst = new Date(utcNow.getTime() + 9 * 3600 * 1000);
  for (let i = 0; i < days; i++) {
    const d = new Date(jst);
    d.setUTCDate(d.getUTCDate() + i);
    const year = d.getUTCFullYear();
    const dateStr = d.toISOString().slice(0, 10);
    const holidays = getJpHolidays(year);
    if (holidays.has(dateStr)) {
      results.push({ date: dateStr, name: getHolidayName(d, year) });
    }
  }
  return results;
}

function getHolidayName(jst: Date, year: number): string {
  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  const dow = jst.getUTCDay();

  const fixed: Record<string, string> = {
    "01-01": "元日",
    "02-11": "建国記念の日",
    "02-23": "天皇誕生日",
    "04-29": "昭和の日",
    "05-03": "憲法記念日",
    "05-04": "みどりの日",
    "05-05": "こどもの日",
    "08-11": "山の日",
    "11-03": "文化の日",
    "11-23": "勤労感謝の日",
  };

  const key = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (fixed[key]) return fixed[key];

  if (month === 1 && day === 1) return "元日";
  if (month === 12 && day === 31) return "年末休場";
  if (month === 1 && (day === 2 || day === 3)) return "年始休場";
  if (month === 3 && day === springEquinoxDay(year)) return "春分の日";
  if (month === 9 && day === autumnEquinoxDay(year)) return "秋分の日";
  if (month === 1 && dow === 1 && day === nthMonday(year, 1, 2)) return "成人の日";
  if (month === 7 && dow === 1) return "海の日";
  if (month === 9 && dow === 1) return "敬老の日";
  if (month === 10 && dow === 1) return "スポーツの日";
  return "振替休日 / 国民の休日";
}
