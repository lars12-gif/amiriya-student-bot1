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

function loadDb() {
  const defaults = {
    schedule: null,
    homework: [],
    absences: null,
    announcements: [],
    files: [],
    suggestions: []
  };
  try {
    const saved = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}
let db = loadDb();

function saveDb() {
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(temp, DB_FILE);
}

const userStates = new Map();

function baghdadDate() {
  return new Date().toLocaleString("en-GB", { timeZone: "Asia/Baghdad" });
}

function mainKeyboard(showAdmin = false) {
  const keyboard = new InlineKeyboard()
    .text("📅 الجدول الدراسي", "student:schedule")
    .text("📚 الواجبات", "student:homework").row()
    .text("📋 الغيابات", "student:absences")
    .text("📢 الإعلانات", "student:announcements").row()
    .text("📁 الملفات والمحاضرات", "student:files")
    .text("✉️ اقتراح أو شكوى", "student:suggest").row();
  if (showAdmin) keyboard.text("⚙️ لوحة الإدارة", "admin:panel");
  return keyboard;
}

function backKeyboard() {
  return new InlineKeyboard().text("⬅️ القائمة الرئيسية", "menu:home");
}

function adminKeyboard() {
  return new InlineKeyboard()
    .text("🖼️ تحديث صورة الجدول", "admin:set_schedule").row()
    .text("➕ تثبيت واجب جديد", "admin:add_homework").row()
    .text("📋 تثبيت قائمة الغيابات", "admin:set_absences").row()
    .text("📢 نشر إعلان", "admin:add_announcement").row()
    .text("📎 رفع ملف أو محاضرة", "admin:add_file").row()
    .text("📝 عرض الاقتراحات", "admin:suggestions").row()
    .text("⬅️ القائمة الرئيسية", "menu:home");
}

async function isAdmin(ctx, userId = ctx.from?.id) {
  if (!userId) return false;
  try {
    const member = await bot.api.getChatMember(GROUP_ID, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch (err) {
    console.error("Admin check failed:", err.message);
    return false;
  }
}

async function sendHome(ctx, edit = false) {
  const text = "🎓 بوت إعدادية العامرية للبنين\nالسادس العلمي — قاعة 1\n\nأهلاً بك! اختر الخدمة المطلوبة:";
  const keyboard = mainKeyboard(await isAdmin(ctx));
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
      return;
    } catch {}
  }
  await ctx.reply(text, { reply_markup: keyboard });
}

async function sendBack(ctx, text) {
  await ctx.reply(text, { reply_markup: backKeyboard() });
}

bot.command("start", async (ctx) => sendHome(ctx));
bot.command("help", async (ctx) => sendHome(ctx));

bot.callbackQuery("menu:home", async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendHome(ctx, true);
});

bot.callbackQuery("admin:panel", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx))) {
    return ctx.reply("⛔ لوحة الإدارة مخصصة لمشرفي المجموعة فقط.");
  }
  await ctx.reply("⚙️ لوحة الإدارة\nاختر العملية المطلوبة:", { reply_markup: adminKeyboard() });
});

bot.callbackQuery(/^student:(schedule|homework|absences|announcements|files|suggest)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const action = ctx.match[1];

  if (action === "schedule") {
    if (!db.schedule) return sendBack(ctx, "📅 لم تُرفع صورة الجدول حتى الآن.");
    if (db.schedule.type === "photo") {
      await ctx.api.sendPhoto(ctx.chat.id, db.schedule.file_id, {
        caption: `📅 الجدول الدراسي الحالي\nآخر تحديث: ${db.schedule.date}`,
        reply_markup: backKeyboard()
      });
    } else {
      await sendBack(ctx, `📅 الجدول الدراسي:\n\n${db.schedule.text}`);
    }
    return;
  }

  if (action === "homework") {
    if (!db.homework.length) return sendBack(ctx, "📚 لا توجد واجبات مثبتة حالياً.");
    const items = db.homework.slice(-10).reverse();
    return sendBack(ctx, "📚 آخر الواجبات المثبتة:\n\n" +
      items.map((item, i) => `${i + 1}. ${item.text}\n🕒 ${item.date}`).join("\n\n"));
  }

  if (action === "absences") {
    if (!db.absences) return sendBack(ctx, "📋 لم تُثبت قائمة غيابات حالياً.");
    if (db.absences.type === "photo") {
      await ctx.api.sendPhoto(ctx.chat.id, db.absences.file_id, {
        caption: `📋 قائمة الغيابات الأخيرة\nالتاريخ: ${db.absences.date}`,
        reply_markup: backKeyboard()
      });
    } else {
      await sendBack(ctx, `📋 قائمة الغيابات الأخيرة\nالتاريخ: ${db.absences.date}\n\n${db.absences.text}`);
    }
    return;
  }

  if (action === "announcements") {
    if (!db.announcements.length) return sendBack(ctx, "📢 لا توجد إعلانات حالياً.");
    const items = db.announcements.slice(-10).reverse();
    return sendBack(ctx, "📢 آخر الإعلانات:\n\n" +
      items.map((item, i) => `${i + 1}. ${item.text}\n🕒 ${item.date}`).join("\n\n"));
  }

  if (action === "files") {
    if (!db.files.length) return sendBack(ctx, "📁 لا توجد ملفات مرفوعة حالياً.");
    const keyboard = new InlineKeyboard();
    db.files.slice(-15).reverse().forEach((item) => {
      keyboard.text(`📄 ${item.name.slice(0, 35)}`, `file:${item.id}`).row();
    });
    keyboard.text("⬅️ القائمة الرئيسية", "menu:home");
    await ctx.reply("📁 الملفات والمحاضرات المتاحة:\nاختر الملف لتحميله:", { reply_markup: keyboard });
    return;
  }

  if (action === "suggest") {
    userStates.set(ctx.from.id, { action: "student_suggestion" });
    await sendBack(ctx, "✉️ اكتب اقتراحك أو شكواك برسالة واحدة، وسأقوم بإرسالها للإدارة.");
  }
});

bot.callbackQuery(/^file:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  const item = db.files.find((x) => x.id === id);
  if (!item) return ctx.reply("هذا الملف غير موجود حالياً.");
  try {
    await ctx.api.sendDocument(ctx.chat.id, item.file_id, {
      caption: item.name,
      reply_markup: backKeyboard()
    });
  } catch (err) {
    console.error("File send failed:", err.message);
    await ctx.reply("تعذر إرسال الملف حالياً.");
  }
});

const adminPrompts = {
  set_schedule: "🖼️ أرسل صورة الجدول الدراسي الجديدة الآن. ستصبح هي الجدول الحالي.",
  add_homework: "📚 أرسل نص الواجب الجديد برسالة واحدة.",
  set_absences: "📋 أرسل قائمة الغيابات الجديدة كنص أو صورة. اكتب أسماء الغائبين فقط. ستُستبدل القائمة السابقة.",
  add_announcement: "📢 أرسل نص الإعلان الذي تريد نشره في المجموعة.",
  add_file: "📎 أرسل الملف أو صورة المحاضرة التي تريد إضافتها."
};

for (const action of Object.keys(adminPrompts)) {
  bot.callbackQuery(`admin:${action}`, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await isAdmin(ctx))) return ctx.reply("⛔ هذا الإجراء مخصص للإدارة فقط.");
    userStates.set(ctx.from.id, { action });
    await ctx.reply(adminPrompts[action], { reply_markup: backKeyboard() });
  });
}

bot.callbackQuery("admin:suggestions", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx))) return ctx.reply("⛔ هذا الإجراء مخصص للإدارة فقط.");
  const items = db.suggestions.slice(-10).reverse();
  if (!items.length) return ctx.reply("لا توجد اقتراحات حالياً.");
  const text = items.map((x, i) => `${i + 1}. ${x.name || "طالب"} (ID: ${x.user_id})\n${x.text}\n${x.date}`).join("\n\n");
  await ctx.reply("📝 آخر الاقتراحات:\n\n" + text);
});

bot.on("message", async (ctx, next) => {
  const state = userStates.get(ctx.from?.id);
  if (!state) return next();

  if (state.action === "student_suggestion") {
    if (!ctx.message.text) {
      return ctx.reply("يرجى إرسال الاقتراح أو الشكوى كنص.");
    }
    db.suggestions.push({
      user_id: ctx.from.id,
      name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
      text: ctx.message.text.trim(),
      date: baghdadDate()
    });
    saveDb();
    userStates.delete(ctx.from.id);
    return ctx.reply("✅ وصل اقتراحك/شكواك وتم حفظه. شكراً لمساهمتك.", { reply_markup: mainKeyboard(await isAdmin(ctx)) });
  }

  if (!(await isAdmin(ctx))) {
    userStates.delete(ctx.from.id);
    return ctx.reply("⛔ يجب أن تكون مشرفاً في المجموعة لتنفيذ هذا الإجراء.");
  }

  const action = state.action;

  if (action === "set_schedule") {
    if (!ctx.message.photo?.length) return ctx.reply("أرسل صورة للجدول حتى أعتمدها.");
    db.schedule = { type: "photo", file_id: ctx.message.photo.at(-1).file_id, date: baghdadDate() };
    saveDb();
    userStates.delete(ctx.from.id);
    return ctx.reply("✅ تم تحديث صورة الجدول الدراسي.");
  }

  if (action === "add_homework") {
    if (!ctx.message.text?.trim()) return ctx.reply("أرسل الواجب كنص.");
    db.homework.push({ text: ctx.message.text.trim(), date: baghdadDate() });
    saveDb();
    userStates.delete(ctx.from.id);
    return ctx.reply("✅ تم تثبيت الواجب الجديد.");
  }

  if (action === "set_absences") {
    if (ctx.message.photo?.length) {
      db.absences = { type: "photo", file_id: ctx.message.photo.at(-1).file_id, date: baghdadDate() };
    } else if (ctx.message.text?.trim()) {
      db.absences = { type: "text", text: ctx.message.text.trim(), date: baghdadDate() };
    } else {
      return ctx.reply("أرسل قائمة الغيابات كنص أو صورة.");
    }
    saveDb();
    userStates.delete(ctx.from.id);
    return ctx.reply("✅ تم تثبيت قائمة الغيابات الجديدة واستبدال السابقة.");
  }

  if (action === "add_announcement") {
    if (!ctx.message.text?.trim()) return ctx.reply("أرسل الإعلان كنص.");
    const item = { text: ctx.message.text.trim(), date: baghdadDate() };
    db.announcements.push(item);
    saveDb();
    userStates.delete(ctx.from.id);
    try {
      await bot.api.sendMessage(GROUP_ID, `📢 إعلان جديد\n\n${item.text}`);
      return ctx.reply("✅ تم حفظ الإعلان ونشره في المجموعة.");
    } catch (err) {
      console.error("Announcement failed:", err.message);
      return ctx.reply("تم حفظ الإعلان، لكن تعذر نشره في المجموعة. تحقق من صلاحيات البوت.");
    }
  }

  if (action === "add_file") {
    let fileId, name;
    if (ctx.message.document) {
      fileId = ctx.message.document.file_id;
      name = ctx.message.document.file_name || "ملف بدون اسم";
    } else if (ctx.message.photo?.length) {
      fileId = ctx.message.photo.at(-1).file_id;
      name = "صورة تعليمية";
    } else {
      return ctx.reply("أرسل ملفاً أو صورة.");
    }
    const id = db.files.length ? Math.max(...db.files.map((x) => x.id)) + 1 : 1;
    db.files.push({ id, file_id: fileId, name });
    saveDb();
    userStates.delete(ctx.from.id);
    return ctx.reply(`✅ تمت إضافة الملف.\nرقمه: ${id}`);
  }

  return next();
});

// Welcome new members with the inline menu.
bot.on("message:new_chat_members", async (ctx) => {
  if (String(ctx.chat.id) !== String(GROUP_ID)) return;
  for (const member of ctx.message.new_chat_members) {
    if (member.is_bot) continue;
    await ctx.reply(
      `أهلاً ${member.first_name} 👋\nنورت إعدادية العامرية للبنين — السادس العلمي، قاعة 1.\nاستخدم الأزرار للوصول إلى خدمات البوت.`,
      { reply_markup: mainKeyboard() }
    );
  }
});

// Basic link moderation in the configured group.
bot.on("message:text", async (ctx, next) => {
  if (String(ctx.chat.id) !== String(GROUP_ID)) return next();
  if (/(https?:\/\/|t\.me\/|www\.)/i.test(ctx.message.text || "") && !(await isAdmin(ctx))) {
    try {
      await ctx.deleteMessage();
      await ctx.reply("⚠️ نشر الروابط مسموح للإدارة فقط.");
    } catch (err) {
      console.error("Moderation failed:", err.message);
    }
    return;
  }
  return next();
});

bot.catch((err) => {
  console.error("Bot error:", err.error?.message || err.message || err);
});

(async () => {
  try {
    const me = await bot.api.getMe();
    console.log(`Bot starting: @${me.username}`);
    await bot.start({ onStart: () => console.log("Bot is running.") });
  } catch (err) {
    console.error("Startup failed:", err.message);
    process.exit(1);
  }
})();
