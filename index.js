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
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { schedule: "", homework: [], announcements: [], files: [], suggestions: [], attendance: {} };
  }
}
let db = loadDb();

function saveDb() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_FILE);
}

function isGroup(ctx) {
  return String(ctx.chat?.id) === String(GROUP_ID);
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

async function requireAdmin(ctx) {
  if (!(await isAdmin(ctx))) {
    await ctx.reply("⛔ هذا الأمر مخصص لمشرفي المجموعة وإدارتها فقط.");
    return false;
  }
  return true;
}

function helpText() {
  return [
    "🎓 بوت طلاب إعدادية العامرية للبنين",
    "السادس العلمي — قاعة 1",
    "",
    "أوامر الطلاب:",
    "/schedule — الجدول",
    "/tasks — الواجبات",
    "/announcements — الإعلانات",
    "/files — الملفات المرفوعة",
    "/getfile رقم — تحميل ملف",
    "/present — عرض حالة حضورك",
    "/suggest نص — إرسال اقتراح أو شكوى",
    "",
    "أوامر الإدارة:",
    "/admin — قائمة أوامر الإدارة",
  ].join("\n");
}

bot.command("start", async (ctx) => ctx.reply(helpText()));
bot.command("help", async (ctx) => ctx.reply(helpText()));

bot.command("schedule", async (ctx) => {
  await ctx.reply(db.schedule ? `📅 جدول الدروس:\n\n${db.schedule}` : "لم تتم إضافة الجدول بعد.");
});

bot.command("tasks", async (ctx) => {
  if (!db.homework.length) return ctx.reply("📚 لا توجد واجبات مسجلة حالياً.");
  const latest = db.homework.slice(-15).reverse();
  await ctx.reply("📚 الواجبات:\n\n" + latest.map((x, i) => `${i + 1}. ${x.text}\n🕒 ${x.date}`).join("\n\n"));
});

bot.command("announcements", async (ctx) => {
  if (!db.announcements.length) return ctx.reply("📢 لا توجد إعلانات حالياً.");
  const latest = db.announcements.slice(-10).reverse();
  await ctx.reply("📢 آخر الإعلانات:\n\n" + latest.map((x, i) => `${i + 1}. ${x.text}\n🕒 ${x.date}`).join("\n\n"));
});

bot.command("files", async (ctx) => {
  if (!db.files.length) return ctx.reply("📁 لا توجد ملفات مرفوعة حالياً.");
  const latest = db.files.slice(-20).reverse();
  await ctx.reply("📁 الملفات المتاحة:\n\n" + latest.map(x => `#${x.id} — ${x.name}`).join("\n") + "\n\nلتحميل ملف أرسل: /getfile رقم");
});

bot.command("getfile", async (ctx) => {
  const id = Number(ctx.match);
  const item = db.files.find(x => x.id === id);
  if (!item) return ctx.reply("لم أجد ملفاً بهذا الرقم. استخدم /files لعرض الملفات.");
  try {
    await ctx.api.sendDocument(ctx.chat.id, item.file_id, { caption: item.name });
  } catch (err) {
    console.error("Send file failed:", err.message);
    await ctx.reply("تعذر إرسال الملف حالياً.");
  }
});

bot.command("present", async (ctx) => {
  const userId = String(ctx.from.id);
  const status = db.attendance[userId];
  await ctx.reply(status
    ? `🗓️ حالة حضورك المسجلة: ${status.status}\nالتاريخ: ${status.date}`
    : "لم تُسجل لك حالة حضور حتى الآن.");
});

bot.command("suggest", async (ctx) => {
  const text = (ctx.match || "").trim();
  if (!text) return ctx.reply("اكتب اقتراحك بعد الأمر هكذا:\n/suggest أرجو إضافة ملخصات الدروس");
  db.suggestions.push({
    user_id: ctx.from.id,
    name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
    text,
    date: new Date().toLocaleString("en-GB", { timeZone: "Asia/Baghdad" })
  });
  saveDb();
  await ctx.reply("✅ وصل اقتراحك/شكواك وتم حفظه. شكراً لمساهمتك.");
});

bot.command("admin", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  await ctx.reply([
    "🛠️ أوامر الإدارة:",
    "/set_schedule نص الجدول",
    "/homework نص الواجب",
    "/announce نص الإعلان",
    "/attendance user_id حاضر أو غائب",
    "/suggestions — عرض آخر الاقتراحات",
    "",
    "يمكن تنفيذ أوامر الإدارة في المجموعة أو الخاص بعد بدء المحادثة مع البوت."
  ].join("\n"));
});

bot.command("set_schedule", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const text = (ctx.match || "").trim();
  if (!text) return ctx.reply("استخدم:\n/set_schedule الأحد: رياضيات، الاثنين: فيزياء...");
  db.schedule = text;
  saveDb();
  await ctx.reply("✅ تم تحديث الجدول.");
});

bot.command("homework", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const text = (ctx.match || "").trim();
  if (!text) return ctx.reply("استخدم:\n/homework حل أسئلة الفصل الأول");
  db.homework.push({ text, date: new Date().toLocaleString("en-GB", { timeZone: "Asia/Baghdad" }) });
  saveDb();
  await ctx.reply("✅ تمت إضافة الواجب.");
});

bot.command("announce", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const text = (ctx.match || "").trim();
  if (!text) return ctx.reply("استخدم:\n/announce تذكير: امتحان الفيزياء يوم الخميس");
  const item = { text, date: new Date().toLocaleString("en-GB", { timeZone: "Asia/Baghdad" }) };
  db.announcements.push(item);
  saveDb();
  try {
    await bot.api.sendMessage(GROUP_ID, `📢 إعلان جديد\n\n${text}`);
    await ctx.reply("✅ تم حفظ الإعلان وإرساله إلى المجموعة.");
  } catch (err) {
    console.error("Announcement send failed:", err.message);
    await ctx.reply("تم حفظ الإعلان، لكن تعذر إرساله للمجموعة. تأكد أن البوت موجود بالمجموعة.");
  }
});

bot.command("attendance", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const args = (ctx.match || "").trim().split(/\s+/);
  if (args.length < 2) {
    return ctx.reply("استخدم:\n/attendance user_id حاضر\nأو\n/attendance user_id غائب");
  }
  const userId = args[0];
  const status = args.slice(1).join(" ");
  db.attendance[userId] = {
    status,
    date: new Date().toLocaleString("en-GB", { timeZone: "Asia/Baghdad" })
  };
  saveDb();
  await ctx.reply(`✅ تم تسجيل حالة الحضور للمستخدم ${userId}: ${status}`);
});

bot.command("suggestions", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const latest = db.suggestions.slice(-10).reverse();
  if (!latest.length) return ctx.reply("لا توجد اقتراحات حالياً.");
  await ctx.reply("📝 آخر الاقتراحات:\n\n" + latest.map((x, i) =>
    `${i + 1}. ${x.name || "طالب"} (ID: ${x.user_id})\n${x.text}\n${x.date}`
  ).join("\n\n"));
});

// Admin file uploads in the configured group or in a private chat.
bot.on(["message:document", "message:photo"], async (ctx, next) => {
  if (!(await isAdmin(ctx))) return next();
  let fileId, name;
  if (ctx.message.document) {
    fileId = ctx.message.document.file_id;
    name = ctx.message.document.file_name || "ملف بدون اسم";
  } else {
    const photo = ctx.message.photo.at(-1);
    fileId = photo.file_id;
    name = "صورة تعليمية";
  }
  const nextId = db.files.length ? Math.max(...db.files.map(x => x.id)) + 1 : 1;
  db.files.push({ id: nextId, file_id: fileId, name });
  saveDb();
  await ctx.reply(`✅ تم حفظ الملف.\nرقم الملف: ${nextId}\nيمكن للطلاب تحميله بالأمر /getfile ${nextId}`);
});

// Welcome new members.
bot.on("message:new_chat_members", async (ctx) => {
  if (!isGroup(ctx)) return;
  for (const member of ctx.message.new_chat_members) {
    if (member.is_bot) continue;
    await ctx.reply(`أهلاً ${member.first_name} 👋\nنورت إعدادية العامرية للبنين — السادس العلمي، قاعة 1.\nاكتب /start لمعرفة أوامر البوت.`);
  }
});

// Basic anti-link moderation in the configured group.
bot.on("message:text", async (ctx, next) => {
  if (!isGroup(ctx)) return next();
  const text = ctx.message.text || "";
  if (/(https?:\/\/|t\.me\/|www\.)/i.test(text) && !(await isAdmin(ctx))) {
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
    await bot.start({
      onStart: () => console.log("Bot is running. Keep this process alive.")
    });
  } catch (err) {
    console.error("Startup failed:", err.message);
    process.exit(1);
  }
})();
