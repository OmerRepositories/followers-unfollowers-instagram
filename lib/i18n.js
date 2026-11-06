// UI strings in Hebrew and English. The language follows Chrome's UI language:
// Hebrew if Chrome is in Hebrew, English otherwise.
(function (root) {
  const STRINGS = {
    he: {
      noScanYet: 'עדיין לא בוצעה סריקה',
      noScanHeader: 'עדיין לא בוצעה סריקה — לחץ "סרוק עכשיו" (צריך להיות מחובר לאינסטגרם בדפדפן הזה)',
      accountLine: '@{user} · סריקה אחרונה: {date} · {n} סריקות',
      scanNow: 'סרוק עכשיו',
      resumeScan: 'המשך סריקה ({n} נסרקו)',
      restart: 'התחל מחדש',
      pause: 'השהה',
      resume: 'המשך',
      stop: 'עצור',
      searchPlaceholder: 'חיפוש לפי שם משתמש או שם…',
      hideVerified: 'הסתר חשבונות מאומתים',
      exportCsv: 'ייצוא CSV',
      showMore: 'הצג עוד',
      showMoreN: 'הצג עוד ({n} נוספים)',
      footer: 'הנתונים נשמרים רק בדפדפן שלך. סריקות תכופות מדי עלולות לגרום לאינסטגרם להגביל את החשבון זמנית — מומלץ לסרוק פעם ביום לכל היותר.',
      clearAll: 'מחק את כל הנתונים',
      clearConfirm: 'למחוק את כל הסריקות, ההיסטוריה והרשימה הלבנה?',

      tab_notBack: 'לא עוקבים בחזרה',
      tab_lost: 'הורידו לי עוקב',
      tab_gained: 'עוקבים חדשים',
      tab_fans: 'אני לא עוקב בחזרה',
      tab_mutual: 'הדדיים',
      tab_iUnfollowed: 'הפסקתי לעקוב',
      tab_whitelist: 'רשימה לבנה',
      tab_history: 'היסטוריית סריקות',
      hint_notBack: 'אנשים שאתה עוקב אחריהם והם לא עוקבים אחריך (ללא הרשימה הלבנה).',
      hint_lost: 'מי שהפסיק לעקוב אחריך, לפי השוואה בין סריקות. חשבון שנמחק או הושבת יופיע גם כאן.',
      hint_gained: 'מי שהתחיל לעקוב אחריך מאז הסריקות הקודמות.',
      hint_fans: 'עוקבים אחריך, אבל אתה לא עוקב אחריהם.',
      hint_mutual: 'אתם עוקבים זה אחרי זה.',
      hint_iUnfollowed: 'חשבונות שאתה הפסקת לעקוב אחריהם.',
      hint_whitelist: 'חשבונות שסימנת ★ — הם לא יופיעו ב"לא עוקבים בחזרה" (למשל סלבריטאים ומותגים).',
      hint_history: '',

      stat_followers: 'עוקבים',
      stat_following: 'נעקבים',
      stat_notBack: 'לא עוקבים בחזרה',
      stat_lost: 'הורידו לי עוקב (סה"כ)',
      stat_gained: 'עוקבים חדשים (סה"כ)',
      stat_mutual: 'הדדיים',

      phase_init: 'מתחבר…',
      phase_followers: 'סורק עוקבים',
      phase_following: 'סורק נעקבים',
      pausedPrefix: '⏸ מושהה · ',
      progressOf: ' מתוך {total}',
      waitRate: ' · אינסטגרם ביקש להאט, ממשיך בעוד {sec} שניות',
      waitRetry: ' · שגיאה זמנית, מנסה שוב בעוד {sec} שניות',
      tailPaused: ' — לחץ "המשך" כדי להמשיך מאותה נקודה.',
      tailRunning: ' — אפשר להמשיך לגלוש, אל תסגור את לשונית האינסטגרם.',
      scanFailed: 'הסריקה נכשלה: {why}',
      progressSaved: ' · ההתקדמות נשמרה, אפשר ללחוץ "המשך סריקה".',
      scanStopped: 'הסריקה נעצרה. ההתקדמות נשמרה, לחץ "המשך סריקה" כדי להמשיך מאותה נקודה, או "התחל מחדש".',
      firstScanDone: 'הסריקה הראשונה הושלמה: {followers} עוקבים, {following} נעקבים. מהסריקה הבאה אוכל להראות מי הוריד לך עוקב.',
      scanDone: 'הסריקה הושלמה: {lost} הורידו לך עוקב, {gained} עוקבים חדשים.',

      err_NOT_LOGGED_IN: 'לא נמצא משתמש מחובר. היכנס לאינסטגרם בלשונית ונסה שוב.',
      err_AUTH: 'אינסטגרם דחה את הבקשה — ודא שאתה מחובר לחשבון בלשונית instagram.com.',
      err_NO_TAB: 'לא הצלחתי לפתוח לשונית של אינסטגרם.',
      err_STALE: 'הסריקה נקטעה (כנראה לשונית האינסטגרם נסגרה). נסה שוב.',
      err_NOT_APPLIED: 'אינסטגרם לא ביצע את הפעולה — אתה עדיין עוקב.',
      err_unknown: 'שגיאה לא ידועה',

      emptyNoData: 'אין עדיין נתונים. לחץ "סרוק עכשיו" כדי להתחיל.',
      emptyNeedTwo: 'צריך לפחות שתי סריקות כדי לזהות שינויים. סרוק שוב מחר.',
      emptyList: 'אין כאן אף אחד 🎉',
      badgeVerified: 'מאומת',
      badgePrivate: 'פרטי',
      badgeStillFollowing: 'אתה עדיין עוקב',
      badgeFollowsAgain: 'חזר לעקוב',
      wlAdd: 'הוסף לרשימה הלבנה',
      wlRemove: 'הסר מהרשימה הלבנה',

      unfollow: 'הפסק לעקוב',
      unfollowQueued: 'בתור…',
      unfollowWorking: 'מבטל…',
      unfollowFailed: 'נכשל, נסה שוב',
      unfollowDone: 'הפסקת לעקוב אחרי {name}',
      unfollowDoneUnverified: 'הבקשה להפסיק לעקוב אחרי {name} נשלחה, אבל לא הצלחתי לאמת. הסריקה הבאה תאשר.',
      unfollowQueueLeft: ' · עוד {n} בתור',
      unfollowBlocked: 'אינסטגרם חסם זמנית הפסקות מעקב ({why}). כדאי לחכות כמה שעות לפני שממשיכים.',
      unfollowError: 'לא הצלחתי להפסיק לעקוב אחרי {name}: {why}',

      th_date: 'תאריך',
      th_followers: 'עוקבים',
      th_following: 'נעקבים',
      th_lost: 'הורידו עוקב',
      th_gained: 'עוקבים חדשים',
    },

    en: {
      noScanYet: 'No scan yet',
      noScanHeader: 'No scan yet — click "Scan now" (you need to be logged in to Instagram in this browser)',
      accountLine: '@{user} · Last scan: {date} · {n} scans',
      scanNow: 'Scan now',
      resumeScan: 'Resume scan ({n} scanned)',
      restart: 'Start over',
      pause: 'Pause',
      resume: 'Resume',
      stop: 'Stop',
      searchPlaceholder: 'Search by username or name…',
      hideVerified: 'Hide verified accounts',
      exportCsv: 'Export CSV',
      showMore: 'Show more',
      showMoreN: 'Show more ({n} left)',
      footer: 'Your data stays in this browser only. Scanning too often can get your account temporarily limited by Instagram — once a day at most is recommended.',
      clearAll: 'Delete all data',
      clearConfirm: 'Delete all scans, history and the whitelist?',

      tab_notBack: "Don't follow back",
      tab_lost: 'Unfollowed me',
      tab_gained: 'New followers',
      tab_fans: "I don't follow back",
      tab_mutual: 'Mutual',
      tab_iUnfollowed: 'I unfollowed',
      tab_whitelist: 'Whitelist',
      tab_history: 'Scan history',
      hint_notBack: "People you follow who don't follow you back (whitelist excluded).",
      hint_lost: 'People who stopped following you, found by comparing scans. Deleted or deactivated accounts show up here too.',
      hint_gained: 'People who started following you since earlier scans.',
      hint_fans: "They follow you, but you don't follow them.",
      hint_mutual: 'You follow each other.',
      hint_iUnfollowed: 'Accounts you stopped following.',
      hint_whitelist: 'Accounts you starred ★ — they are hidden from "Don\'t follow back" (e.g. celebrities and brands).',
      hint_history: '',

      stat_followers: 'Followers',
      stat_following: 'Following',
      stat_notBack: "Don't follow back",
      stat_lost: 'Unfollowed me (total)',
      stat_gained: 'New followers (total)',
      stat_mutual: 'Mutual',

      phase_init: 'Connecting…',
      phase_followers: 'Scanning followers',
      phase_following: 'Scanning following',
      pausedPrefix: '⏸ Paused · ',
      progressOf: ' of {total}',
      waitRate: ' · Instagram asked to slow down, continuing in {sec}s',
      waitRetry: ' · Temporary error, retrying in {sec}s',
      tailPaused: ' — click "Resume" to continue from the same point.',
      tailRunning: " — you can keep browsing, just don't close the Instagram tab.",
      scanFailed: 'Scan failed: {why}',
      progressSaved: ' · Progress was saved, you can click "Resume scan".',
      scanStopped: 'Scan stopped. Progress was saved — click "Resume scan" to continue from the same point, or "Start over".',
      firstScanDone: 'First scan complete: {followers} followers, {following} following. From the next scan on I can show who unfollowed you.',
      scanDone: 'Scan complete: {lost} unfollowed you, {gained} new followers.',

      err_NOT_LOGGED_IN: 'No logged-in user found. Log in to Instagram in a tab and try again.',
      err_AUTH: 'Instagram rejected the request — make sure you are logged in on instagram.com.',
      err_NO_TAB: "Couldn't open an Instagram tab.",
      err_STALE: 'The scan was interrupted (the Instagram tab was probably closed). Try again.',
      err_NOT_APPLIED: "Instagram didn't apply it — you are still following.",
      err_unknown: 'Unknown error',

      emptyNoData: 'No data yet. Click "Scan now" to start.',
      emptyNeedTwo: 'At least two scans are needed to detect changes. Scan again tomorrow.',
      emptyList: 'Nobody here 🎉',
      badgeVerified: 'Verified',
      badgePrivate: 'Private',
      badgeStillFollowing: 'You still follow',
      badgeFollowsAgain: 'Follows again',
      wlAdd: 'Add to whitelist',
      wlRemove: 'Remove from whitelist',

      unfollow: 'Unfollow',
      unfollowQueued: 'Queued…',
      unfollowWorking: 'Unfollowing…',
      unfollowFailed: 'Failed, retry',
      unfollowDone: 'You unfollowed {name}',
      unfollowDoneUnverified: "Unfollow request for {name} was sent but couldn't be verified. The next scan will confirm.",
      unfollowQueueLeft: ' · {n} more in queue',
      unfollowBlocked: 'Instagram temporarily blocked unfollows ({why}). Wait a few hours before continuing.',
      unfollowError: "Couldn't unfollow {name}: {why}",

      th_date: 'Date',
      th_followers: 'Followers',
      th_following: 'Following',
      th_lost: 'Unfollowed',
      th_gained: 'New followers',
    },
  };

  function detectLang() {
    let ui = '';
    try {
      ui = (root.chrome && chrome.i18n && chrome.i18n.getUILanguage()) || '';
    } catch {
      // not running inside the extension (tests)
    }
    if (!ui && root.navigator) ui = navigator.language || '';
    return /^(he|iw)\b/i.test(ui) ? 'he' : 'en';
  }

  const lang = detectLang();
  const dict = STRINGS[lang];

  function t(key, vars) {
    let s = dict[key] ?? STRINGS.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return s;
  }

  // Fills elements marked with data-i18n / data-i18n-placeholder and sets the
  // page direction.
  function applyToDocument(doc) {
    doc.documentElement.lang = lang;
    doc.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    doc.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  }

  const api = { t, lang, locale: lang === 'he' ? 'he-IL' : 'en-US', applyToDocument, STRINGS };
  root.I18N = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
