const { Bot, InlineKeyboard } = require("grammy");
const fs = require("node:fs");
const path = require("node:path");

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.GROUP_ID;
if (!BOT_TOKEN || !GROUP_ID) {
  console.error("Missing BOT_TOKEN or GROUP_ID environment variable.");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

const defaults = { schedule: null, homework: [], absences: null, announcements: [], files: [], suggestions: [] };
function loadDb() {
  try {
    const saved = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return { ...defaults, ...saved };
  } catch { return { ...defaults }; }
}
let db = loadDb();
function saveDb() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_FILE);
}
const states = new Map();
const dateNow = () => new Date().toLocaleString("en-GB", { timeZone: "Asia/Baghdad" });

async function isGroupAdmin(userId) {
  try {
    const m = await bot.api.getChatMember(GROUP_ID, userId);
    return m.status === "administrator" || m.status === "creator";
  } catch (e) {
    console.error("Admin check:", e.message);
    return false;
  }
}
function isPrivate(ctx) { return ctx.chat?.type === "private"; }
function mainKeyboard(showAdmin = false) {
  const k = new InlineKeyboard()
    .text("📅 الجدول الدراسي", "s:schedule").text("📚 الواجبات", "s:homework").row()
    .text("📋 الغيابات", "s:absences").text("📢 الإعلانات", "s:announcements").row()
    .text("📁 الملفات والمحاضرات", "s:files").row()
    .text("✉️ اقتراح أو شكوى", "s:suggest").row();
  if (showAdmin) k.text("⚙️ لوحة الإدارة", "a:panel").row();
  return k;
}
const back = () => new InlineKeyboard().text("⬅️ القائمة الرئيسية", "nav:home");
function adminKeyboard() {
  return new InlineKeyboard()
    .text("🖼️ تحديث صورة الجدول", "a:schedule").row()
    .text("➕ تثبيت واجب جديد", "a:homework").row()
    .text("📋 تثبيت قائمة الغيابات", "a:absences").row()
    .text("📢 نشر إعلان", "a:announcement").row()
    .text("📎 رفع ملف أو محاضرة", "a:file").row()
    .text("📝 عرض الاقتراحات", "a:suggestions").row()
    .text("⬅️ القائمة الرئيسية", "nav:home");
}

async function homeText(ctx) {
  const admin = isPrivate(ctx) && await isGroupAdmin(ctx.from.id);
  return ctx.editMessageText(
    "🎓 بوت إعدادية العامرية للبنين\nالسادس العلمي — قاعة 1\n\nأهلاً بك! اختر الخدمة المطلوبة:",
    { reply_markup: mainKeyboard(admin) }
  );
}
async function editScreen(ctx, text, keyboard = back()) {
  try {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch (e) {
    if (!String(e.description || e.message).includes("message is not modified")) throw e;
  }
}
async function requirePrivateAdmin(ctx) {
  if (!isPrivate(ctx)) {
    await ctx.answerCallbackQuery({ text: "لوحة الإدارة متاحة في الخاص مع البوت فقط.", show_alert: true });
    return false;
  }
  if (!(await isGroupAdmin(ctx.from.id))) {
    await ctx.answerCallbackQuery({ text: "هذه الميزة للمشرفين الحاليين في المجموعة فقط.", show_alert: true });
    return false;
  }
  return true;
}

bot.command("start", async ctx => {
  const admin = isPrivate(ctx) && await isGroupAdmin(ctx.from.id);
  await ctx.reply(
    "🎓 بوت إعدادية العامرية للبنين\nالسادس العلمي — قاعة 1\n\nأهلاً بك! اختر الخدمة المطلوبة:",
    { reply_markup: mainKeyboard(admin) }
  );
});
bot.command("help", async ctx => {
  const admin = isPrivate(ctx) && await isGroupAdmin(ctx.from.id);
  await ctx.reply("🎓 خدمات إعدادية العامرية للبنين — السادس العلمي، قاعة 1\n\nاختر الخدمة من الأزرار:", { reply_markup: mainKeyboard(admin) });
});

bot.callbackQuery("nav:home", async ctx => {
  await ctx.answerCallbackQuery();
  try { await homeText(ctx); }
  catch { await ctx.reply("اكتب /start لفتح القائمة الرئيسية."); }
});

bot.callbackQuery("a:panel", async ctx => {
  if (!(await requirePrivateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  await editScreen(ctx, "⚙️ لوحة الإدارة\nاختر العملية المطلوبة:", adminKeyboard());
});

bot.callbackQuery(/^s:(schedule|homework|absences|announcements|files|suggest)$/, async ctx => {
  await ctx.answerCallbackQuery();
  const action = ctx.match[1];

  if (action === "schedule") {
    if (!db.schedule) return editScreen(ctx, "📅 لم تُرفع صورة الجدول حتى الآن.");
    // Telegram cannot turn a text message into a photo while preserving that same message.
    // Keep navigation in one message and provide the current schedule as a photo attachment.
    await ctx.api.sendPhoto(ctx.chat.id, db.schedule.file_id, {
      caption: `📅 الجدول الدراسي الحالي\nآخر تحديث: ${db.schedule.date}`
    });
    return;
  }
  if (action === "homework") {
    const items = db.homework.slice(-10).reverse();
    return editScreen(ctx, items.length
      ? "📚 آخر الواجبات المثبتة:\n\n" + items.map((x,i)=>`${i+1}. ${x.text}\n🕒 ${x.date}`).join("\n\n")
      : "📚 لا توجد واجبات مثبتة حالياً.");
  }
  if (action === "absences") {
    if (!db.absences) return editScreen(ctx, "📋 لا توجد قائمة غيابات مثبتة حالياً.");
    const text = db.absences.type === "text" ? db.absences.text : "القائمة محفوظة كصورة. اضغط زر عرض الصورة أدناه.";
    const keyboard = db.absences.type === "photo"
      ? new InlineKeyboard().text("🖼️ عرض صورة قائمة الغيابات", "s:absence_photo").row().text("⬅️ القائمة الرئيسية", "nav:home")
      : back();
    return editScreen(ctx, `📋 قائمة الغيابات الأخيرة\nالتاريخ: ${db.absences.date}\n\n${text}`, keyboard);
  }
  if (action === "announcements") {
    const items = db.announcements.slice(-10).reverse();
    return editScreen(ctx, items.length
      ? "📢 آخر الإعلانات:\n\n" + items.map((x,i)=>`${i+1}. ${x.text}\n🕒 ${x.date}`).join("\n\n")
      : "📢 لا توجد إعلانات حالياً.");
  }
  if (action === "files") {
    if (!db.files.length) return editScreen(ctx, "📁 لا توجد ملفات مرفوعة حالياً.");
    const k = new InlineKeyboard();
    db.files.slice(-15).reverse().forEach(x => k.text(`📄 ${x.name.slice(0,30)}`, `f:${x.id}`).row());
    k.text("⬅️ القائمة الرئيسية", "nav:home");
    return editScreen(ctx, "📁 الملفات والمحاضرات\nاختر الملف المطلوب:", k);
  }
  if (action === "suggest") {
    states.set(`${ctx.chat.id}:${ctx.from.id}`, { action: "suggest" });
    return editScreen(ctx, "✉️ أرسل اقتراحك أو شكواك برسالة نصية واحدة.\n\nبعد الإرسال ستعود للقائمة الرئيسية.");
  }
});

bot.callbackQuery("s:absence_photo", async ctx => {
  await ctx.answerCallbackQuery();
  if (!db.absences || db.absences.type !== "photo") return editScreen(ctx, "📋 لا توجد صورة غيابات حالياً.");
  await ctx.api.sendPhoto(ctx.chat.id, db.absences.file_id, { caption: `📋 قائمة الغيابات — ${db.absences.date}` });
});

bot.callbackQuery(/^f:(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  const item = db.files.find(x => x.id === Number(ctx.match[1]));
  if (!item) return editScreen(ctx, "هذا الملف غير متوفر حالياً.");
  // Telegram documents are delivered as separate messages; the file list stays intact.
  await ctx.api.sendDocument(ctx.chat.id, item.file_id, { caption: item.name });
});

const prompts = {
  schedule: "أرسل صورة الجدول الجديدة. ستستبدل الصورة الحالية.",
  homework: "أرسل نص الواجب الجديد.",
  absences: "أرسل قائمة الغيابات الجديدة كنص أو صورة. ستُستبدل القائمة السابقة.",
  announcement: "أرسل نص الإعلان الذي تريد نشره في المجموعة.",
  file: "أرسل ملفاً أو صورة محاضرة لإضافتها."
};
for (const action of Object.keys(prompts)) {
  bot.callbackQuery(`a:${action}`, async ctx => {
    if (!(await requirePrivateAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    states.set(`${ctx.chat.id}:${ctx.from.id}`, { action });
    await editScreen(ctx, `⚙️ ${prompts[action]}`, back());
  });
}
bot.callbackQuery("a:suggestions", async ctx => {
  if (!(await requirePrivateAdmin(ctx))) return;
  await ctx.answerCallbackQuery();
  const items = db.suggestions.slice(-10).reverse();
  return editScreen(ctx, items.length
    ? "📝 آخر الاقتراحات:\n\n" + items.map((x,i)=>`${i+1}. ${x.name || "طالب"} (ID: ${x.user_id})\n${x.text}\n${x.date}`).join("\n\n")
    : "📝 لا توجد اقتراحات حالياً.", adminKeyboard());
});

bot.on("message", async (ctx, next) => {
  const key = `${ctx.chat.id}:${ctx.from.id}`;
  const state = states.get(key);
  if (!state) return next();

  if (state.action === "suggest") {
    if (!ctx.message.text?.trim()) return ctx.reply("أرسل الاقتراح كنص من فضلك.");
    db.suggestions.push({ user_id: ctx.from.id, name: ctx.from.first_name, text: ctx.message.text.trim(), date: dateNow() });
    saveDb();
    states.delete(key);
    return ctx.reply("✅ تم استلام اقتراحك.", { reply_markup: mainKeyboard(isPrivate(ctx) && await isGroupAdmin(ctx.from.id)) });
  }

  // All admin input is accepted only in private chat.
  if (!isPrivate(ctx) || !(await isGroupAdmin(ctx.from.id))) {
    states.delete(key);
    return ctx.reply("⛔ أوامر الإدارة تعمل في الخاص فقط، ويجب أن تكون مشرفاً حالياً في المجموعة.");
  }

  const a = state.action;
  if (a === "schedule") {
    if (!ctx.message.photo?.length) return ctx.reply("أرسل صورة للجدول.");
    db.schedule = { type: "photo", file_id: ctx.message.photo.at(-1).file_id, date: dateNow() };
  } else if (a === "homework") {
    if (!ctx.message.text?.trim()) return ctx.reply("أرسل الواجب كنص.");
    db.homework.push({ text: ctx.message.text.trim(), date: dateNow() });
  } else if (a === "absences") {
    if (ctx.message.photo?.length) db.absences = { type: "photo", file_id: ctx.message.photo.at(-1).file_id, date: dateNow() };
    else if (ctx.message.text?.trim()) db.absences = { type: "text", text: ctx.message.text.trim(), date: dateNow() };
    else return ctx.reply("أرسل القائمة كنص أو صورة.");
  } else if (a === "announcement") {
    if (!ctx.message.text?.trim()) return ctx.reply("أرسل الإعلان كنص.");
    const item = { text: ctx.message.text.trim(), date: dateNow() };
    db.announcements.push(item);
    saveDb();
    states.delete(key);
    try { await bot.api.sendMessage(GROUP_ID, `📢 إعلان جديد\n\n${item.text}`); }
    catch (e) { console.error("Announcement delivery:", e.message); }
    return ctx.reply("✅ تم حفظ الإعلان وإرساله للمجموعة.");
  } else if (a === "file") {
    let file_id, name;
    if (ctx.message.document) { file_id = ctx.message.document.file_id; name = ctx.message.document.file_name || "ملف"; }
    else if (ctx.message.photo?.length) { file_id = ctx.message.photo.at(-1).file_id; name = "صورة تعليمية"; }
    else return ctx.reply("أرسل ملفاً أو صورة.");
    const id = db.files.length ? Math.max(...db.files.map(x=>x.id))+1 : 1;
    db.files.push({ id, file_id, name });
  }
  saveDb();
  states.delete(key);
  return ctx.reply("✅ تم حفظ التحديث بنجاح.", { reply_markup: adminKeyboard() });
});

bot.on("message:new_chat_members", async ctx => {
  if (String(ctx.chat.id) !== String(GROUP_ID)) return;
  for (const member of ctx.message.new_chat_members) {
    if (!member.is_bot) await ctx.reply(`أهلاً ${member.first_name} 👋\nنورت إعدادية العامرية للبنين — السادس العلمي، قاعة 1.\nاضغط /start لفتح القائمة التفاعلية.`);
  }
});

bot.on("message:text", async (ctx, next) => {
  if (String(ctx.chat.id) !== String(GROUP_ID)) return next();
  if (/(https?:\/\/|t\.me\/|www\.)/i.test(ctx.message.text || "") && !(await isGroupAdmin(ctx.from.id))) {
    try { await ctx.deleteMessage(); await ctx.reply("⚠️ نشر الروابط مسموح للإدارة فقط."); }
    catch (e) { console.error("Link moderation:", e.message); }
    return;
  }
  return next();
});

bot.catch(err => console.error("Bot error:", err.error?.message || err.message || err));
(async () => {
  try {
    const me = await bot.api.getMe();
    console.log(`Starting @${me.username}`);
    await bot.start({ onStart: () => console.log("Bot is running.") });
  } catch (e) {
    console.error("Startup failed:", e.message);
    process.exit(1);
  }
})();
