const { Bot, InlineKeyboard } = require('grammy');
const fs = require('node:fs');
const path = require('node:path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.GROUP_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!BOT_TOKEN || !GROUP_ID) {
  console.error('Missing BOT_TOKEN or GROUP_ID');
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

const defaults = {
  schedule: null,
  homework: [],
  absences: null,
  announcements: [],
  files: [],
  suggestions: []
};

function loadDb() {
  try {
    return {
      ...defaults,
      ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
    };
  } catch {
    return { ...defaults };
  }
}

let db = loadDb();

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

const states = new Map();
const aiCooldown = new Map();

const STATE_TTL_MS = 10 * 60 * 1000;
const AI_COOLDOWN_MS = 10 * 1000;

const stateKey = ctx => `${ctx.chat.id}:${ctx.from.id}`;

const cancelKeyboard = () =>
  new InlineKeyboard().text('✖️ إلغاء العملية', 'flow:cancel');

const dateNow = () =>
  new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Baghdad'
  });

async function isGroupAdmin(userId) {
  try {
    const m = await bot.api.getChatMember(GROUP_ID, userId);
    return m.status === 'administrator' || m.status === 'creator';
  } catch (e) {
    console.error('Admin check:', e.message);
    return false;
  }
}

const isPrivate = ctx => ctx.chat?.type === 'private';

function mainKeyboard(showAdmin = false) {
  const k = new InlineKeyboard()
    .text('📅 الجدول الدراسي', 's:schedule')
    .text('📚 الواجبات', 's:homework')
    .row()
    .text('📋 الغيابات', 's:absences')
    .text('📢 الإعلانات', 's:announcements')
    .row()
    .text('📁 الملفات والمحاضرات', 's:files')
    .row()
    .text('🤖 اسأل المساعد الذكي', 's:ai')
    .row()
    .text('✉️ اقتراح أو شكوى', 's:suggest')
    .row();

  if (showAdmin) {
    k.text('⚙️ لوحة الإدارة', 'a:panel').row();
  }

  return k;
}

const back = () =>
  new InlineKeyboard().text('⬅️ القائمة الرئيسية', 'nav:home');

function adminKeyboard() {
  return new InlineKeyboard()
    .text('🖼️ تحديث صورة الجدول', 'a:schedule')
    .row()
    .text('➕ تثبيت واجب جديد', 'a:homework')
    .row()
    .text('📋 تثبيت قائمة الغيابات', 'a:absences')
    .row()
    .text('📢 نشر إعلان', 'a:announcement')
    .row()
    .text('📎 رفع ملف أو محاضرة', 'a:file')
    .row()
    .text('📝 عرض الاقتراحات', 'a:suggestions')
    .row()
    .text('⬅️ القائمة الرئيسية', 'nav:home');
}

async function homeText(ctx) {
  const admin = isPrivate(ctx) && await isGroupAdmin(ctx.from.id);

  return ctx.editMessageText(
    '🎓 بوت إعدادية العامرية للبنين\nالسادس العلمي — قاعة 1\n\nأهلاً بك! اختر الخدمة المطلوبة:',
    { reply_markup: mainKeyboard(admin) }
  );
}

async function editScreen(ctx, text, keyboard = back()) {
  try {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch (e) {
    if (!String(e.description || e.message).includes('message is not modified')) {
      throw e;
    }
  }
}

async function requirePrivateAdmin(ctx) {
  if (!isPrivate(ctx)) {
    await ctx.answerCallbackQuery({
      text: 'لوحة الإدارة متاحة في الخاص مع البوت فقط.',
      show_alert: true
    });
    return false;
  }

  if (!(await isGroupAdmin(ctx.from.id))) {
    await ctx.answerCallbackQuery({
      text: 'هذه الميزة للمشرفين الحاليين في المجموعة فقط.',
      show_alert: true
    });
    return false;
  }

  return true;
}

// ========================================
// AI SYSTEM - GROQ
// ========================================

const AI_SYSTEM_PROMPT = `
أنت المساعد الدراسي الرسمي لبوت إعدادية العامرية للبنين.
أنت متخصص حصراً في تدريس المنهج العراقي للسادس العلمي.

━━━━━━━━━━━━━━━━━━
أولاً: المرجع الدراسي
━━━━━━━━━━━━━━━━━━

1. مرجعك الدراسي الوحيد هو المنهج العراقي الرسمي للسادس العلمي.
2. لا تستخدم مناهج دول أخرى ولا تستبدل المصطلحات العراقية بمصطلحات من مناهج أجنبية.
3. لا تقدم معلومات خارج المنهج على أنها جزء منه.
4. لا تنسب أي تعريف أو قانون أو نص إلى كتاب الوزارة دون التأكد.
5. إذا لم تكن متأكداً من أن المعلومة موجودة في المنهج العراقي، وضّح ذلك للطالب.
6. إذا طلب الطالب نصاً حرفياً من الكتاب ولم تكن متأكداً من النص، اطلب منه إرسال صورة الصفحة.
7. لا تخترع أرقام صفحات أو فصول أو أسماء مصادر.

━━━━━━━━━━━━━━━━━━
ثانياً: الإجابة الوزارية
━━━━━━━━━━━━━━━━━━

اجعل الإجابة مناسبة لأسلوب الامتحانات الوزارية العراقية.

عند السؤال عن تعريف:
- اكتب التعريف العلمي المختصر والدقيق.
- لا تضف شرحاً طويلاً داخل التعريف.
- ضع الشرح الإضافي بعد التعريف عند الحاجة.

عند السؤال عن التعليل:
- ابدأ بكلمة "السبب:" أو "التعليل:".
- اذكر السبب العلمي المباشر.
- لا تخرج عن المطلوب.

عند السؤال عن التعداد:
- استخدم نقاطاً مرقمة.
- لا تسقط أي نقطة تعرف أنها مطلوبة في المنهج.

عند السؤال عن المقارنة:
- استخدم جدولاً أو نقاطاً متقابلة.
- وضح أوجه الاختلاف المطلوبة فقط.

عند السؤال عن المسائل الرياضية والفيزيائية والكيميائية:
- اكتب المعطيات.
- اكتب القانون المناسب.
- عوّض بالقيم.
- وضح خطوات الحل.
- اكتب الناتج النهائي مع الوحدة.
- راجع الإشارات والوحدات والحسابات.

عند السؤال عن القوانين:
- اكتب القانون بصورة واضحة.
- عرف الرموز.
- اذكر الوحدات عند الحاجة.

━━━━━━━━━━━━━━━━━━
ثالثاً: الدقة وعدم التخمين
━━━━━━━━━━━━━━━━━━

1. الدقة أهم من سرعة الإجابة.
2. راجع السؤال جيداً قبل الإجابة.
3. لا تتسرع في إعطاء جواب غير متأكد منه.
4. لا توافق الطالب على معلومة خاطئة لمجرد أنه اقترحها.
5. إذا احتمل السؤال أكثر من معنى، اطلب توضيحاً.
6. إذا لم تتوفر لديك معلومات كافية، قل ذلك بصراحة.
7. لا تخترع إجابة وزارية ولا تدّعِ أن إجابتك مطابقة حرفياً للكتاب دون دليل.
8. إذا أرسل الطالب صورة من الكتاب، اعتمد على محتواها في الإجابة، ولا تتجاهل أي شرط أو ملاحظة ظاهرة فيها.

إذا لم تستطع التأكد من الجواب، استخدم العبارة:
"حتى أعطيك إجابة وزارية دقيقة ومطابقة للمنهج، أرسل صورة الصفحة أو نص الفقرة من كتاب الوزارة."

━━━━━━━━━━━━━━━━━━
رابعاً: تنسيق الإجابات
━━━━━━━━━━━━━━━━━━

1. أجب بالعربية الواضحة.
2. استخدم اللهجة العراقية في التوضيح البسيط فقط.
3. اجعل الإجابة العلمية بالفصحى المناسبة للامتحان.
4. استخدم عناوين واضحة.
5. اترك سطراً فارغاً بين الفقرات.
6. لا تستخدم LaTeX.
7. لا تكتب رموزاً برمجية أو أوامر تنسيق.
8. اكتب المعادلات بصيغة نصية واضحة، مثل:
   ΔS = Q / T
   وليس أوامر LaTeX.
9. استخدم الرموز العلمية الصحيحة مثل:
   Δ ، π ، × ، ÷ ، ≥ ، ≤ ، °C
10. لا تكثر من الإيموجي.
11. لا تكتب مقدمات طويلة قبل الإجابة.
12. لا تخلط بين التعريف والشرح والملاحظات.

━━━━━━━━━━━━━━━━━━
خامساً: أسلوب التعامل مع الطالب
━━━━━━━━━━━━━━━━━━

- أنت مدرس مساعد للسادس العلمي العراقي.
- ساعد الطالب على فهم المادة والاستعداد للامتحانات الوزارية.
- إذا طلب جواباً مختصراً، أعطه الجواب المختصر.
- إذا طلب شرحاً، اشرح خطوة بخطوة.
- إذا طلب صيغة وزارية، اجعلها مباشرة ومنظمة.
- لا تدّعِ امتلاك نسخة من كتاب الوزارة إذا لم تكن متاحة لك.
- لا تخرج عن المواد الدراسية للسادس العلمي إلا إذا طلب الطالب موضوعاً آخر بوضوح.

تذكر دائماً:
صحة المعلومة ومطابقتها للمنهج أهم من سرعة الرد أو طول الإجابة.
`;

// تحويل التنسيقات إلى نص مناسب لتليغرام
function formatAiAnswer(text) {
  if (!text) return '';

  return text
    .replace(/\\\[/g, '')
    .replace(/\\\]/g, '')
    .replace(/\\\(/g, '')
    .replace(/\\\)/g, '')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\geq/g, '≥')
    .replace(/\\leq/g, '≤')
    .replace(/\\neq/g, '≠')
    .replace(/\\rightarrow/g, '→')
    .replace(/\\pi/g, 'π')
    .replace(/\\approx/g, '≈')
    .replace(/\\pm/g, '±')
    .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1) / ($2)')
    .replace(/\\text\{([^{}]+)\}/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/```(?:\w+)?/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// طلب الإجابة من Groq
async function askGroq(question) {
  if (!GROQ_API_KEY) {
    throw new Error('AI_NOT_CONFIGURED');
  }

  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [
          {
            role: 'system',
            content: AI_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: question
          }
        ],
        temperature: 0.2,
        max_completion_tokens: 1800
      })
    }
  );

  if (response.status === 429) {
    throw new Error('AI_LIMIT');
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('AI_KEY');
  }

  if (!response.ok) {
    console.error(
      'Groq API error:',
      response.status,
      (await response.text()).slice(0, 400)
    );
    throw new Error('AI_ERROR');
  }

  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error('AI_EMPTY');
  }

  return answer;
}

// إرسال الإجابة للطالب
async function handleAiQuestion(ctx, question) {
  const last = aiCooldown.get(ctx.from.id) || 0;
  const wait = AI_COOLDOWN_MS - (Date.now() - last);

  if (wait > 0) {
    return ctx.reply(
      `⏳ انتظر ${Math.ceil(wait / 1000)} ثوانٍ قبل إرسال سؤال آخر.`
    );
  }

  aiCooldown.set(ctx.from.id, Date.now());

  if (!GROQ_API_KEY) {
    return ctx.reply(
      '⚙️ المساعد غير مفعّل. أضف GROQ_API_KEY إلى متغيرات الاستضافة.'
    );
  }

  const status = await ctx.reply(
    '🤖 تم استلام سؤالك.\n\n📚 يجري إعداد الإجابة الدراسية والتدقيق فيها...'
  );

  try {
    const rawAnswer = await askGroq(question);
    const answer = formatAiAnswer(rawAnswer);

    const chunks = answer.match(/[\s\S]{1,3900}/g) || [
      'لم أتمكن من إعداد إجابة.'
    ];

    await ctx.api.editMessageText(
      ctx.chat.id,
      status.message_id,
      chunks[0]
    );

    for (const chunk of chunks.slice(1)) {
      await ctx.reply(chunk);
    }
  } catch (e) {
    console.error('AI request:', e.message);

    const msg =
      e.message === 'AI_LIMIT'
        ? '⏳ انتهى حد الاستخدام المجاني مؤقتاً. حاول بعد تجدد الحصة.'
        : e.message === 'AI_KEY'
          ? '⚙️ مفتاح Groq غير صحيح أو لا يملك الصلاحية.'
          : e.message === 'AI_EMPTY'
            ? 'لم تصل إجابة. جرّب صياغة السؤال بطريقة أخرى.'
            : '⚠️ المساعد غير متاح حالياً. حاول لاحقاً.';

    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        status.message_id,
        msg
      );
    } catch {
      await ctx.reply(msg);
    }
  }
}

// ========================================
// START
// ========================================

bot.command('start', async ctx => {
  const admin = isPrivate(ctx) && await isGroupAdmin(ctx.from.id);

  await ctx.reply(
    '🎓 بوت إعدادية العامرية للبنين\nالسادس العلمي — قاعة 1\n\nأهلاً بك! اختر الخدمة المطلوبة:',
    { reply_markup: mainKeyboard(admin) }
  );
});

// HELP
bot.command('help', async ctx => {
  const admin = isPrivate(ctx) && await isGroupAdmin(ctx.from.id);

  await ctx.reply(
    '🎓 خدمات إعدادية العامرية للبنين\n\n' +
    '🤖 !ai سؤالك هنا — اسأل المساعد الدراسي\n' +
    '↩️ رد على رسالة بـ !ai لشرحها\n' +
    '!help — عرض الأوامر\n' +
    '/start — القائمة الرئيسية\n' +
    '/cancel — إلغاء العملية',
    { reply_markup: mainKeyboard(admin) }
  );
});

// HOME
bot.callbackQuery('nav:home', async ctx => {
  await ctx.answerCallbackQuery();

  try {
    await homeText(ctx);
  } catch {
    await ctx.reply('اكتب /start لفتح القائمة الرئيسية.');
  }
});

// CANCEL BUTTON
bot.callbackQuery('flow:cancel', async ctx => {
  states.delete(stateKey(ctx));

  await ctx.answerCallbackQuery({
    text: 'تم إلغاء العملية.'
  });

  const admin = isPrivate(ctx) && await isGroupAdmin(ctx.from.id);

  await editScreen(
    ctx,
    '↩️ تم إلغاء العملية.\n\nاختر الخدمة المطلوبة:',
    mainKeyboard(admin)
  );
});

// CANCEL COMMAND
bot.command('cancel', async ctx => {
  const existed = states.delete(stateKey(ctx));
  const admin = isPrivate(ctx) && await isGroupAdmin(ctx.from.id);

  await ctx.reply(
    existed ? '✖️ تم إلغاء العملية.' : 'لا توجد عملية معلّقة.',
    { reply_markup: mainKeyboard(admin) }
  );
});

// ADMIN PANEL
bot.callbackQuery('a:panel', async ctx => {
  if (!(await requirePrivateAdmin(ctx))) return;

  await ctx.answerCallbackQuery();

  await editScreen(
    ctx,
    '⚙️ لوحة الإدارة\nاختر العملية المطلوبة:',
    adminKeyboard()
  );
});

// AI BUTTON
bot.callbackQuery('s:ai', async ctx => {
  await ctx.answerCallbackQuery();

  states.set(stateKey(ctx), {
    action: 'ai',
    expiresAt: Date.now() + STATE_TTL_MS
  });

  await editScreen(
    ctx,
    '🤖 المساعد الدراسي للمنهج العراقي\n\n' +
    '📚 متخصص بالسادس العلمي.\n' +
    'أرسل سؤالك برسالة نصية واحدة.\n\n' +
    'سيحاول تقديم إجابة منظمة بأسلوب وزاري، ' +
    'وإذا احتاج إلى نص الكتاب سيطلب منك صورة الصفحة.',
    cancelKeyboard()
  );
});

// STUDENT SERVICES
bot.callbackQuery(
  /^s:(schedule|homework|absences|announcements|files|suggest)$/,
  async ctx => {
    await ctx.answerCallbackQuery();

    const action = ctx.match[1];

    if (action === 'schedule') {
      if (!db.schedule) {
        return editScreen(ctx, '📅 لم تُرفع صورة الجدول حتى الآن.');
      }

      await ctx.api.sendPhoto(ctx.chat.id, db.schedule.file_id, {
        caption: `📅 الجدول الدراسي الحالي\nآخر تحديث: ${db.schedule.date}`
      });

      return;
    }

    if (action === 'homework') {
      const items = db.homework.slice(-10).reverse();

      return editScreen(
        ctx,
        items.length
          ? '📚 آخر الواجبات المثبتة:\n\n' +
            items.map((x, i) =>
              `${i + 1}. ${x.text}\n🕒 ${x.date}`
            ).join('\n\n')
          : '📚 لا توجد واجبات مثبتة حالياً.'
      );
    }

    if (action === 'absences') {
      if (!db.absences) {
        return editScreen(ctx, '📋 لا توجد قائمة غيابات مثبتة حالياً.');
      }

      const t = db.absences.type === 'text'
        ? db.absences.text
        : 'القائمة محفوظة كصورة. اضغط زر عرض الصورة أدناه.';

      const k = db.absences.type === 'photo'
        ? new InlineKeyboard()
            .text('🖼️ عرض صورة قائمة الغيابات', 's:absence_photo')
            .row()
            .text('⬅️ القائمة الرئيسية', 'nav:home')
        : back();

      return editScreen(
        ctx,
        `📋 قائمة الغيابات الأخيرة\nالتاريخ: ${db.absences.date}\n\n${t}`,
        k
      );
    }

    if (action === 'announcements') {
      const items = db.announcements.slice(-10).reverse();

      return editScreen(
        ctx,
        items.length
          ? '📢 آخر الإعلانات:\n\n' +
            items.map((x, i) =>
              `${i + 1}. ${x.text}\n🕒 ${x.date}`
            ).join('\n\n')
          : '📢 لا توجد إعلانات حالياً.'
      );
    }

    if (action === 'files') {
      if (!db.files.length) {
        return editScreen(ctx, '📁 لا توجد ملفات مرفوعة حالياً.');
      }

      const k = new InlineKeyboard();

      db.files.slice(-15).reverse().forEach(x => {
        k.text(`📄 ${x.name.slice(0, 30)}`, `f:${x.id}`).row();
      });

      k.text('⬅️ القائمة الرئيسية', 'nav:home');

      return editScreen(
        ctx,
        '📁 الملفات والمحاضرات\nاختر الملف المطلوب:',
        k
      );
    }

    if (action === 'suggest') {
      states.set(stateKey(ctx), {
        action: 'suggest',
        expiresAt: Date.now() + STATE_TTL_MS
      });

      return editScreen(
        ctx,
        '✉️ أرسل اقتراحك أو شكواك برسالة نصية واحدة.\nهذه العملية خاصة بحسابك.',
        cancelKeyboard()
      );
    }
  }
);

// ABSENCE PHOTO
bot.callbackQuery('s:absence_photo', async ctx => {
  await ctx.answerCallbackQuery();

  if (!db.absences || db.absences.type !== 'photo') {
    return editScreen(ctx, '📋 لا توجد صورة غيابات حالياً.');
  }

  await ctx.api.sendPhoto(ctx.chat.id, db.absences.file_id, {
    caption: `📋 قائمة الغيابات — ${db.absences.date}`
  });
});

// FILES
bot.callbackQuery(/^f:(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();

  const item = db.files.find(x => x.id === Number(ctx.match[1]));

  if (!item) {
    return editScreen(ctx, 'هذا الملف غير متوفر حالياً.');
  }

  await ctx.api.sendDocument(ctx.chat.id, item.file_id, {
    caption: item.name
  });
});

// ADMIN ACTIONS
const prompts = {
  schedule: 'أرسل صورة الجدول الجديدة. ستستبدل الصورة الحالية.',
  homework: 'أرسل نص الواجب الجديد.',
  absences: 'أرسل قائمة الغيابات الجديدة كنص أو صورة.',
  announcement: 'أرسل نص الإعلان الذي تريد نشره في المجموعة.',
  file: 'أرسل ملفاً أو صورة محاضرة لإضافتها.'
};

for (const action of Object.keys(prompts)) {
  bot.callbackQuery(`a:${action}`, async ctx => {
    if (!(await requirePrivateAdmin(ctx))) return;

    await ctx.answerCallbackQuery();

    states.set(stateKey(ctx), {
      action,
      expiresAt: Date.now() + STATE_TTL_MS
    });

    await editScreen(
      ctx,
      `⚙️ ${prompts[action]}\n\nيمكنك إلغاء العملية من الزر أدناه.`,
      cancelKeyboard()
    );
  });
}

// SUGGESTIONS
bot.callbackQuery('a:suggestions', async ctx => {
  if (!(await requirePrivateAdmin(ctx))) return;

  await ctx.answerCallbackQuery();

  const items = db.suggestions.slice(-10).reverse();

  return editScreen(
    ctx,
    items.length
      ? '📝 آخر الاقتراحات:\n\n' +
        items.map((x, i) =>
          `${i + 1}. ${x.name || 'طالب'} (ID: ${x.user_id})\n${x.text}\n${x.date}`
        ).join('\n\n')
      : '📝 لا توجد اقتراحات حالياً.',
    adminKeyboard()
  );
});

// MESSAGE FLOWS
bot.on('message', async (ctx, next) => {
  const key = stateKey(ctx);
  const state = states.get(key);

  if (!state) return next();

  if (!state.expiresAt || Date.now() > state.expiresAt) {
    states.delete(key);

    return ctx.reply(
      '⌛ انتهت مهلة العملية تلقائياً. افتح القائمة واختر العملية من جديد.',
      {
        reply_markup: mainKeyboard(
          isPrivate(ctx) && await isGroupAdmin(ctx.from.id)
        )
      }
    );
  }

  if (state.action === 'ai') {
    if (!ctx.message.text?.trim()) {
      return ctx.reply('أرسل سؤالك كنص من فضلك، أو اضغط إلغاء.');
    }

    states.delete(key);

    return handleAiQuestion(ctx, ctx.message.text.trim());
  }

  if (state.action === 'suggest') {
    if (!ctx.message.text?.trim()) {
      return ctx.reply('أرسل الاقتراح كنص من فضلك، أو اضغط إلغاء.');
    }

    db.suggestions.push({
      user_id: ctx.from.id,
      name: ctx.from.first_name,
      text: ctx.message.text.trim(),
      date: dateNow()
    });

    saveDb();
    states.delete(key);

    return ctx.reply('✅ تم استلام اقتراحك.', {
      reply_markup: mainKeyboard(
        isPrivate(ctx) && await isGroupAdmin(ctx.from.id)
      )
    });
  }

  if (!isPrivate(ctx) || !(await isGroupAdmin(ctx.from.id))) {
    states.delete(key);

    return ctx.reply(
      '⛔ أوامر الإدارة تعمل في الخاص فقط، ويجب أن تكون مشرفاً حالياً في المجموعة.'
    );
  }

  const a = state.action;

  if (a === 'schedule') {
    if (!ctx.message.photo?.length) {
      return ctx.reply('أرسل صورة للجدول.');
    }

    db.schedule = {
      type: 'photo',
      file_id: ctx.message.photo.at(-1).file_id,
      date: dateNow()
    };
  } else if (a === 'homework') {
    if (!ctx.message.text?.trim()) {
      return ctx.reply('أرسل الواجب كنص.');
    }

    db.homework.push({
      text: ctx.message.text.trim(),
      date: dateNow()
    });
  } else if (a === 'absences') {
    if (ctx.message.photo?.length) {
      db.absences = {
        type: 'photo',
        file_id: ctx.message.photo.at(-1).file_id,
        date: dateNow()
      };
    } else if (ctx.message.text?.trim()) {
      db.absences = {
        type: 'text',
        text: ctx.message.text.trim(),
        date: dateNow()
      };
    } else {
      return ctx.reply('أرسل القائمة كنص أو صورة.');
    }
  } else if (a === 'announcement') {
    if (!ctx.message.text?.trim()) {
      return ctx.reply('أرسل الإعلان كنص.');
    }

    const item = {
      text: ctx.message.text.trim(),
      date: dateNow()
    };

    db.announcements.push(item);
    saveDb();
    states.delete(key);

    try {
      await bot.api.sendMessage(
        GROUP_ID,
        `📢 إعلان جديد\n\n${item.text}`
      );
    } catch (e) {
      console.error('Announcement delivery:', e.message);
    }

    return ctx.reply('✅ تم حفظ الإعلان وإرساله للمجموعة.');
  } else if (a === 'file') {
    let file_id, name;

    if (ctx.message.document) {
      file_id = ctx.message.document.file_id;
      name = ctx.message.document.file_name || 'ملف';
    } else if (ctx.message.photo?.length) {
      file_id = ctx.message.photo.at(-1).file_id;
      name = 'صورة تعليمية';
    } else {
      return ctx.reply('أرسل ملفاً أو صورة.');
    }

    const id = db.files.length
      ? Math.max(...db.files.map(x => x.id)) + 1
      : 1;

    db.files.push({ id, file_id, name });
  }

  saveDb();
  states.delete(key);

  return ctx.reply('✅ تم حفظ التحديث بنجاح.', {
    reply_markup: adminKeyboard()
  });
});

// PREFIX COMMANDS
bot.on('message:text', async (ctx, next) => {
  const text = ctx.message.text.trim();

  if (/^!help(?:@\w+)?$/i.test(text)) {
    return ctx.reply(
      '📌 أوامر البوت:\n' +
      '• !ai سؤالك — اسأل المساعد الدراسي\n' +
      '• بالرد على رسالة: !ai — اطلب شرحها\n' +
      '• /start — القائمة الرئيسية\n' +
      '• /help — المساعدة'
    );
  }

  const match = text.match(/^!ai(?:@\w+)?(?:\s+([\s\S]*))?$/i);

  if (match) {
    let question = (match[1] || '').trim();

    if (!question && ctx.message.reply_to_message) {
      const r = ctx.message.reply_to_message;

      question = r.text || r.caption || '';

      if (!question) {
        return ctx.reply(
          'الرسالة التي رددت عليها لا تحتوي نصاً يمكن شرحه.'
        );
      }

      question =
        `اشرح هذه الرسالة وأجب عنها وفق المنهج العراقي للسادس العلمي:\n\n${question}`;
    }

    if (!question) {
      return ctx.reply(
        'اكتب سؤالك بعد الأمر، مثال:\n!ai اشرح قانون نيوتن الثاني'
      );
    }

    return handleAiQuestion(ctx, question);
  }

  // LINK MODERATION
  if (
    String(ctx.chat.id) === String(GROUP_ID) &&
    /(https?:\/\/|t\.me\/|www\.)/i.test(text) &&
    !(await isGroupAdmin(ctx.from.id))
  ) {
    try {
      await ctx.deleteMessage();
      await ctx.reply('⚠️ نشر الروابط مسموح للإدارة فقط.');
    } catch (e) {
      console.error('Link moderation:', e.message);
    }

    return;
  }

  return next();
});

// WELCOME NEW MEMBERS
bot.on('message:new_chat_members', async ctx => {
  if (String(ctx.chat.id) !== String(GROUP_ID)) return;

  for (const member of ctx.message.new_chat_members) {
    if (!member.is_bot) {
      await ctx.reply(
        `أهلاً ${member.first_name} 👋\n` +
        'نورت إعدادية العامرية للبنين — السادس العلمي، قاعة 1.\n' +
        'اضغط /start لفتح القائمة التفاعلية.'
      );
    }
  }
});

// ERROR HANDLING
bot.catch(err => {
  console.error(
    'Bot error:',
    err.error?.message || err.message || err
  );
});

// START BOT
(async () => {
  try {
    const me = await bot.api.getMe();

    console.log(`Starting @${me.username}`);

    await bot.start({
      onStart: () => console.log('Bot is running.')
    });
  } catch (e) {
    console.error('Startup failed:', e.message);
    process.exit(1);
  }
})();
