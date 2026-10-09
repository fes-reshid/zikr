/*
 * Reel: AI video maker.
 *
 * Describe the video you want — "a 30-second Reel about patience with rain",
 * "Eid Mubarak from Amina", "lion sounds for kids" — and add your own
 * pictures, videos or a sound if you like. The assistant writes the words,
 * picks a shape, a mood, text designs, painted scenes, a Qur'an verse or
 * hadith where it fits, nature, animal and writing sounds, then builds the
 * video on the timeline with the editor's own tools. Everything it makes
 * stays editable, and you can keep talking to it: "make it longer", "add
 * rain", "gold text", "another version", "read it aloud".
 *
 * It runs on this device: no account, no upload, no cost. A host can connect
 * a language model instead (window.REEL_CONFIG.ai.endpoint): the endpoint gets
 * the request and returns the same kind of plan, which is checked against the
 * editor's own lists before anything is built.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReelAI = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ------------------------------------------------------------ knowledge */

    // Short, well-known verses, with the reference shown on screen so it can be checked.
    const VERSES = {
        '94:6': ['إِنَّ مَعَ الْعُسْرِ يُسْرًا', 'Indeed, with hardship comes ease.'],
        '2:153': ['إِنَّ اللَّهَ مَعَ الصَّابِرِينَ', 'Indeed, Allah is with the patient.'],
        '14:7': ['لَئِن شَكَرْتُمْ لَأَزِيدَنَّكُمْ', 'If you are grateful, I will surely give you more.'],
        '13:28': ['أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ', 'Surely in the remembrance of Allah do hearts find rest.'],
        '2:152': ['فَاذْكُرُونِي أَذْكُرْكُمْ', 'So remember Me; I will remember you.'],
        '65:3': ['وَمَن يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ', 'Whoever puts their trust in Allah, He is enough for them.'],
        '39:53': ['لَا تَقْنَطُوا مِن رَّحْمَةِ اللَّهِ', 'Do not despair of the mercy of Allah.'],
        '20:114': ['رَّبِّ زِدْنِي عِلْمًا', 'My Lord, increase me in knowledge.'],
        '17:24': ['رَّبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا', 'My Lord, have mercy on them as they raised me when I was small.'],
        '2:45': ['وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ', 'Seek help through patience and prayer.'],
        '2:183': ['يَا أَيُّهَا الَّذِينَ آمَنُوا كُتِبَ عَلَيْكُمُ الصِّيَامُ', 'O you who believe, fasting has been prescribed for you.'],
        '97:3': ['لَيْلَةُ الْقَدْرِ خَيْرٌ مِّنْ أَلْفِ شَهْرٍ', 'The Night of Decree is better than a thousand months.'],
        '22:27': ['وَأَذِّن فِي النَّاسِ بِالْحَجِّ', 'And proclaim the Hajj to the people.'],
        '2:195': ['إِنَّ اللَّهَ يُحِبُّ الْمُحْسِنِينَ', 'Indeed, Allah loves those who do good.'],
        '55:13': ['فَبِأَيِّ آلَاءِ رَبِّكُمَا تُكَذِّبَانِ', 'So which of the favours of your Lord would you deny?'],
        '30:21': ['وَجَعَلَ بَيْنَكُم مَّوَدَّةً وَرَحْمَةً', 'And He placed between you affection and mercy.'],
        '2:186': ['وَإِذَا سَأَلَكَ عِبَادِي عَنِّي فَإِنِّي قَرِيبٌ', 'And when My servants ask you about Me, I am near.']
    };
    // The same source-checked texts as the Hadith video tool.
    const HADITH = {
        quran: ['خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ', 'The best of you learn the Qur’an and teach it.', 'Sahih al-Bukhari 5027'],
        brother: ['لَا يُؤْمِنُ أَحَدُكُمْ حَتَّى يُحِبَّ لِأَخِيهِ مَا يُحِبُّ لِنَفْسِهِ', 'Faith calls us to love for our brother the good we love for ourselves.', 'Sahih al-Bukhari 13'],
        intention: ['إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ', 'Deeds are judged by intentions.', 'Sahih al-Bukhari 1'],
        speech: ['مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الآخِرِ فَلْيَقُلْ خَيْرًا أَوْ لِيَصْمُتْ', 'Whoever believes in Allah and the Last Day should speak good or stay silent.', 'Sahih al-Bukhari 6018']
    };

    // Painted scenes (occasions.js) and painted backgrounds (trends.js) the assistant can use.
    const SCENES = ['night-crescent', 'lanterns', 'iftar', 'desert-dusk', 'mosque-dawn', 'green-dome', 'quran-stand', 'eid-sparkle', 'eid-fireworks',
        'eid-sheep-field', 'kaaba', 'arafat', 'mina-tents', 'mountain-lake', 'forest-sun', 'sea-sunset'];
    const PAINTS = ['ink', 'paper', 'spotlight', 'neon', 'film', 'sunny', 'pastel'];
    const NATURE = ['rain', 'wind', 'waves', 'stream', 'birds', 'crickets', 'fire', 'fountain', 'bubbling'];
    const EFFECTS = ['whoosh', 'riser', 'pop', 'click', 'ding', 'success', 'typing', 'page', 'heartbeat', 'shutter', 'drop', 'boom', 'tick'];
    const WRITING = ['chalk', 'pencil', 'typing'];
    const STICKERS = ['arrow', 'star', 'check', 'heart', 'crescent', 'sparkles', 'book', 'lantern', 'mosque', 'kaaba', 'tree', 'dates', 'beads', 'prayerMat',
        'palm', 'flower', 'sunrise', 'mountains', 'cloud', 'rosette', 'gift', 'leaf', 'minaret', 'quran', 'moonStar', 'camel', 'tent', 'drop', 'sun', 'pen',
        'calendar', 'clock', 'mic', 'bulb', 'trophy', 'pin', 'bell', 'thumbs', 'balloon'];
    const DESIGNS = ['caption', 'hook', 'neon-pink', 'neon-blue', 'highlight', 'label', 'comic', 'gold', 'note', 'words', 'arabic-gold', 'pastel', 'number'];

    /** Animal sounds (sounds.js) and the words that ask for them. */
    const ANIMALS = {
        lion: [/\blions?\b|\broar/, /أسد|اسد/], tiger: [/\btigers?\b/, /نمر/], elephant: [/\belephants?\b/, /فيل/], wolf: [/\bwol(f|ves)\b|\bhowl/, /ذئب/],
        cat: [/\bcats?\b|\bkitt(en|y|ens)\b|\bmeow/, /قطة|قط\b|قطط/], dog: [/\bdogs?\b|\bpupp(y|ies)\b|\bbark/, /كلب/], sheep: [/\bsheep\b|\blambs?\b/, /خروف|غنم|خراف/],
        cow: [/\bcows?\b|\bcattle\b|\bmoo\b/, /بقرة|أبقار/], goat: [/\bgoats?\b/, /ماعز|عنزة/], horse: [/\bhorses?\b|\bneigh/, /حصان|خيل/],
        donkey: [/\bdonkeys?\b/, /حمار/], camel: [/\bcamels?\b/, /جمل|ناقة|إبل/], rooster: [/\broosters?\b|\bcockerel/, /ديك/], hens: [/\bhens?\b|\bchickens?\b/, /دجاج/],
        chicks: [/\bchicks?\b/, /كتكوت|صوص/], duck: [/\bducks?\b|\bquack/, /بطة|بط\b/], owl: [/\bowls?\b/, /بومة/], frog: [/\bfrogs?\b/, /ضفدع/],
        bees: [/\bbees?\b|\bbuzz/, /نحل/], seagull: [/\bseagulls?\b|\bgulls?\b/, /نورس/], monkey: [/\bmonkeys?\b/, /قرد/], bear: [/\bbears?\b/, /دب\b|دببة/],
        crow: [/\bcrows?\b/, /غراب/], eagle: [/\beagles?\b|\bfalcons?\b/, /نسر|صقر/], parrot: [/\bparrots?\b/, /ببغاء/], turkey: [/\bturkeys\b|\bgobble/, /ديك رومي/],
        snake: [/\bsnakes?\b|\bhiss/, /ثعبان|أفعى|حية/], mouse: [/\bmouse\b|\bmice\b/, /فأر/], dolphin: [/\bdolphins?\b/, /دلفين/], whale: [/\bwhales?\b/, /حوت/],
        mosquito: [/\bmosquito(es)?\b/, /بعوض/], dove: [/\bdoves?\b|\bpigeons?\b/, /حمام|حمامة/]
    };
    const ANIMAL_NAMES = {
        lion: ['Lion', 'الأسد'], tiger: ['Tiger', 'النمر'], elephant: ['Elephant', 'الفيل'], wolf: ['Wolf', 'الذئب'], cat: ['Cat', 'القطة'], dog: ['Dog', 'الكلب'],
        sheep: ['Sheep', 'الخروف'], cow: ['Cow', 'البقرة'], goat: ['Goat', 'الماعز'], horse: ['Horse', 'الحصان'], donkey: ['Donkey', 'الحمار'], camel: ['Camel', 'الجمل'],
        rooster: ['Rooster', 'الديك'], hens: ['Hens', 'الدجاج'], chicks: ['Chicks', 'الكتاكيت'], duck: ['Duck', 'البطة'], owl: ['Owl', 'البومة'], frog: ['Frog', 'الضفدع'],
        bees: ['Bees', 'النحل'], seagull: ['Seagull', 'النورس'], monkey: ['Monkey', 'القرد'], bear: ['Bear', 'الدب'], crow: ['Crow', 'الغراب'], eagle: ['Eagle', 'النسر'],
        parrot: ['Parrot', 'الببغاء'], turkey: ['Turkey', 'الديك الرومي'], snake: ['Snake', 'الثعبان'], mouse: ['Mouse', 'الفأر'], dolphin: ['Dolphin', 'الدلفين'],
        whale: ['Whale', 'الحوت'], mosquito: ['Mosquito', 'البعوضة'], dove: ['Dove', 'الحمامة']
    };
    const NATURE_WORDS = {
        rain: [/\brain(y|ing|drops?)?\b/, /مطر|أمطار/], wind: [/\bwind(y)?\b|\bbreeze\b/, /رياح|ريح|نسيم/], waves: [/\bwaves?\b|\bocean\b|\bbeach\b|\bsea\b/, /بحر|موج|شاطئ|محيط/],
        stream: [/\bstreams?\b|\brivers?\b|\bwaterfall/, /نهر|جدول|شلال/], birds: [/\bbirds?\b|\bbirdsong\b|\bchirp/, /طيور|عصافير|زقزقة/],
        crickets: [/\bcrickets?\b|\bnight sounds?\b/, /صراصير|ليل هادئ/], fire: [/\bfire(place)?\b|\bcampfire\b|\bbonfire\b/, /نار|موقد/],
        fountain: [/\bfountains?\b/, /نافورة/], bubbling: [/\bbubbl(ing|e|es)\b/, /فقاعات|غليان/]
    };

    /**
     * Topics the assistant knows how to write about: words that ask for it
     * (English, Arabic), a mood, painted scenes or a painted background, the
     * words in both languages, a verse or hadith, a nature sound and stickers.
     */
    const TOPICS = [
        { id: 'ramadan', en: /ramadh?an|\bfasting\b|\biftar\b|\bsuhoor\b|\bsehri\b/, ar: /رمضان|صيام|الصوم|إفطار|سحور/, mood: 'calm',
            scenes: ['night-crescent', 'lanterns', 'iftar', 'desert-dusk', 'quran-stand'], verse: '2:183', ambient: 'crickets', stickers: ['crescent', 'lantern'],
            lines: ['Ramadan Mubarak', 'A month of mercy, Qur’an and forgiveness', 'May Allah accept your fasting and prayers', 'Ramadan Kareem'],
            arLines: ['رمضان مبارك', 'شهر الرحمة والقرآن والمغفرة', 'تقبّل الله صيامكم وقيامكم', 'رمضان كريم'] },
        { id: 'eid-adha', en: /\badha\b|\bqurbani\b|\budh?iyah\b|\beid al[- ]kabir\b/, ar: /الأضحى|أضحية|العيد الكبير/, mood: 'festive',
            scenes: ['eid-sheep-field', 'kaaba', 'eid-sparkle', 'mosque-dawn', 'arafat'], stickers: ['sparkles', 'moonStar'], ambient: 'birds', end: 'ding',
            lines: ['Eid al-Adha Mubarak', 'Taqabbal Allahu minna wa minkum', 'May Allah accept your sacrifice', 'Eid Mubarak'],
            arLines: ['عيد أضحى مبارك', 'تقبّل الله منا ومنكم', 'تقبّل الله أضحيتكم', 'عيدكم مبارك'] },
        { id: 'eid', en: /\beid\b|\beid mubarak\b|\bfitr\b/, ar: /عيد مبارك|عيد الفطر|العيد|عيد/, mood: 'festive',
            scenes: ['eid-sparkle', 'eid-fireworks', 'mosque-dawn', 'lanterns', 'green-dome'], stickers: ['sparkles', 'moonStar'], end: 'ding',
            lines: ['Eid Mubarak', 'Taqabbal Allahu minna wa minkum', 'Wishing you joy, peace and blessings', 'Eid Mubarak to you and your family'],
            arLines: ['عيد مبارك', 'تقبّل الله منا ومنكم', 'أعاده الله علينا وعليكم بالخير والبركة', 'كل عام وأنتم بخير'] },
        { id: 'jumuah', en: /jumu'?[‘’]?ah|\bjumm?a(h)?\b|\bfriday\b|\bkahf\b/, ar: /جمعة|الكهف/, mood: 'calm',
            scenes: ['mosque-dawn', 'green-dome', 'quran-stand', 'sea-sunset', 'mountain-lake'], verse: '13:28', ambient: 'birds', stickers: ['mosque'],
            lines: ['Jumu‘ah Mubarak', 'Read Surah al-Kahf today', 'Send salawat on the Prophet ﷺ', 'Make plenty of du‘a'],
            arLines: ['جمعة مباركة', 'لا تنسوا قراءة سورة الكهف', 'وأكثروا من الصلاة على النبي ﷺ', 'وأكثروا من الدعاء'] },
        { id: 'qadr', en: /\bqadr\b|last ten nights|\blaylat/, ar: /القدر|العشر الأواخر/, mood: 'calm',
            scenes: ['night-crescent', 'quran-stand', 'lanterns', 'desert-dusk'], verse: '97:3', ambient: 'crickets', stickers: ['moonStar'],
            lines: ['Laylat al-Qadr', 'Seek it in the last ten nights', 'Pray, read and make du‘a', 'Better than a thousand months'],
            arLines: ['ليلة القدر', 'التمسوها في العشر الأواخر', 'صلاة وقرآن ودعاء', 'خير من ألف شهر'] },
        { id: 'hajj', en: /\bhajj\b|\bumrah\b|\bmakk?ah\b|\bmecca\b|\bka'?[‘’]?bah?\b|\bpilgrim|\barafat\b/, ar: /حج|عمرة|مكة|الكعبة|عرفة/, mood: 'calm',
            scenes: ['kaaba', 'arafat', 'mina-tents', 'desert-dusk'], verse: '22:27', stickers: ['kaaba'],
            lines: ['Labbayk Allahumma labbayk', 'Here I am, O Allah, here I am', 'May Allah accept every pilgrim', 'Hajj Mabrur'],
            arLines: ['لبيك اللهم لبيك', 'لبيك لا شريك لك لبيك', 'تقبّل الله من الحجاج والمعتمرين', 'حجًّا مبرورًا'] },
        { id: 'patience', en: /patien|\bsabr\b|hardship|hard times|difficult|\btrials?\b|struggl|\bsad(ness)?\b/, ar: /صبر|ابتلاء|شدة|العسر|حزن/, mood: 'calm',
            scenes: ['mountain-lake', 'sea-sunset', 'forest-sun', 'desert-dusk'], verse: '94:6', ambient: 'rain', stickers: ['leaf'],
            lines: ['Be patient', 'Hard days do not last forever', 'Allah is with those who are patient', 'Keep going. Keep praying.'],
            arLines: ['اصبر', 'الأيام الصعبة لا تدوم', 'إن الله مع الصابرين', 'استمر وواصل الدعاء'] },
        { id: 'gratitude', en: /gratitude|grateful|thankful|\bshukr\b|alhamdulillah|blessings?\b/, ar: /الحمد لله|شكر|نعم الله|النعم/, mood: 'calm',
            scenes: ['forest-sun', 'mountain-lake', 'sea-sunset', 'mosque-dawn'], verse: '14:7', ambient: 'birds', stickers: ['sunrise'],
            lines: ['Alhamdulillah', 'For every breath and every blessing', 'Gratitude turns what we have into enough', 'Say it often: Alhamdulillah'],
            arLines: ['الحمد لله', 'على كل نَفَس وكل نعمة', 'الشكر يجعل القليل كثيرًا', 'قلها دائمًا: الحمد لله'] },
        { id: 'dhikr', en: /\bdhikr\b|\bzikr\b|remembrance|anxi|stress|peace of (mind|heart)|tasbi?h|subhanallah/, ar: /ذكر|طمأنينة|قلق|تسبيح|سبحان الله/, mood: 'calm',
            scenes: ['mountain-lake', 'night-crescent', 'sea-sunset', 'forest-sun'], verse: '13:28', ambient: 'stream', stickers: ['beads'],
            lines: ['Remember Allah', 'SubhanAllah · Alhamdulillah · Allahu Akbar', 'When the heart is restless, return to Him', 'Peace is one dhikr away'],
            arLines: ['اذكر الله', 'سبحان الله · الحمد لله · الله أكبر', 'إذا قلق القلب فارجع إليه', 'السكينة في ذكر الله'] },
        { id: 'trust', en: /tawakk?ul|trust (in )?allah|\bworr(y|ied|ies)\b|\brizq\b|provision/, ar: /توكل|رزق|الهم|هموم/, mood: 'calm',
            scenes: ['desert-dusk', 'mountain-lake', 'sea-sunset'], verse: '65:3', ambient: 'wind', stickers: ['sunrise'],
            lines: ['Trust Allah', 'Do your best, then leave the rest to Him', 'What is written for you will reach you', 'Hasbunallahu wa ni‘mal wakeel'],
            arLines: ['توكل على الله', 'اعمل ما عليك ثم فوّض أمرك إليه', 'ما كُتب لك سيصلك', 'حسبنا الله ونعم الوكيل'] },
        { id: 'mercy', en: /\bmercy\b|forgiv|istighfar|repent|tawbah|\bsins?\b|\bhope\b/, ar: /رحمة|مغفرة|استغفار|توبة|ذنوب|أمل/, mood: 'calm',
            scenes: ['night-crescent', 'mosque-dawn', 'sea-sunset'], verse: '39:53', ambient: 'rain', stickers: ['moonStar'],
            lines: ['Never lose hope', 'His mercy is greater than any mistake', 'Turn back to Him — the door is open', 'Astaghfirullah'],
            arLines: ['لا تيأس', 'رحمته أوسع من كل خطأ', 'عُد إليه فالباب مفتوح', 'أستغفر الله'] },
        { id: 'knowledge', en: /knowledge|\blearn|\bstud(y|ying|ent)|\bschool\b|\bexams?\b|\bteach|\bilm\b|madrasa|lesson/, ar: /علم|دراسة|طالب|مدرسة|امتحان|معلم|درس/, mood: 'calm',
            paint: 'paper', verse: '20:114', stickers: ['book', 'pen'],
            lines: ['Seek knowledge', 'Every page brings you closer', 'Learn it, live it, share it', 'Rabbi zidni ‘ilma'],
            arLines: ['اطلب العلم', 'كل صفحة تقرّبك أكثر', 'تعلّمه واعمل به وعلّمه', 'رب زدني علمًا'] },
        { id: 'parents', en: /\bparents?\b|\bmother\b|\bmo(m|mmy)\b|\bmum\b|\bfather\b|\bdad\b|\bfamily\b/, ar: /الوالدين|والدي|أمي|أبي|الأم|الأب|عائلة|أسرة/, mood: 'calm',
            scenes: ['mosque-dawn', 'forest-sun', 'sea-sunset'], verse: '17:24', ambient: 'birds', stickers: ['heart'],
            lines: ['For my parents', 'They carried us when we were small', 'Honour them, serve them, pray for them', 'May Allah have mercy on them'],
            arLines: ['إلى والديّ', 'حملونا ونحن صغار', 'برّوهم وأحسنوا إليهم وادعوا لهم', 'رب ارحمهما كما ربياني صغيرًا'] },
        { id: 'prayer', en: /\bprayers?\b|\bsalah\b|\bsalat\b|\bnamaz\b|\bpray(ing)?\b|\bmosque\b|\bmasjid\b|\badhan\b/, ar: /صلاة|الصلاة|مسجد|أذان/, mood: 'calm',
            scenes: ['mosque-dawn', 'green-dome', 'night-crescent'], verse: '2:45', ambient: 'birds', stickers: ['prayerMat', 'mosque'],
            lines: ['Don’t miss your salah', 'Five meetings a day with your Lord', 'Pray before you are prayed upon', 'Hayya ‘ala as-salah'],
            arLines: ['لا تفوّت صلاتك', 'خمس لقاءات في اليوم مع ربك', 'صلِّ قبل أن يُصلّى عليك', 'حيّ على الصلاة'] },
        { id: 'quran', en: /qur'?[‘’]?a?an|\bkoran\b|\brecit|tilawa|\bhifz\b|memori[sz]/, ar: /القرآن|قرآن|تلاوة|حفظ/, mood: 'calm',
            scenes: ['quran-stand', 'night-crescent', 'mosque-dawn'], hadith: 'quran', ambient: 'crickets', stickers: ['quran'],
            lines: ['Live with the Qur’an', 'Read a page every day', 'Learn it and teach it', 'Let it be your light'],
            arLines: ['عِش مع القرآن', 'اقرأ صفحة كل يوم', 'تعلّمه وعلّمه', 'اجعله نورًا لك'] },
        { id: 'dua', en: /\bdu[‘'’]?a\b|supplication/, ar: /دعاء|الدعاء/, mood: 'calm',
            scenes: ['night-crescent', 'desert-dusk', 'mountain-lake'], verse: '2:186', ambient: 'wind', stickers: ['moonStar'],
            lines: ['Make du‘a', 'He is near and He hears you', 'Ask Him for everything, big and small', 'Never stop asking'],
            arLines: ['ادعُ الله', 'هو قريب يسمعك', 'اسأله كل شيء صغيرًا كان أو كبيرًا', 'لا تتوقف عن الدعاء'] },
        { id: 'kindness', en: /kindness|\bkind\b|good deeds?|charity|sadaqah|helping others|\bsmile\b/, ar: /إحسان|صدقة|لطف|معروف|ابتسامة/, mood: 'calm',
            scenes: ['forest-sun', 'mosque-dawn', 'sea-sunset'], verse: '2:195', ambient: 'birds', stickers: ['heart'],
            lines: ['Be kind', 'A smile is charity', 'Small good deeds, done every day', 'Allah loves those who do good'],
            arLines: ['كن لطيفًا', 'تبسّمك في وجه أخيك صدقة', 'أعمال صغيرة كل يوم', 'إن الله يحب المحسنين'] },
        { id: 'brotherhood', en: /\bbrother(hood)?\b|\bsister(hood)?\b|\bfriends?(hip)?\b|ukhuwwah/, ar: /أخوة|أخي|أختي|صديق|صداقة|محبة/, mood: 'calm',
            scenes: ['sea-sunset', 'forest-sun', 'mountain-lake'], hadith: 'brother', ambient: 'waves', stickers: ['heart'],
            lines: ['Brothers and sisters in faith', 'Love for others what you love for yourself', 'Be there for each other', 'For the sake of Allah'],
            arLines: ['إخوة في الإيمان', 'أحبّ لأخيك ما تحب لنفسك', 'كونوا عونًا لبعضكم', 'في الله'] },
        { id: 'intention', en: /intention|niyy?ah?\b|new start|fresh start|new beginning/, ar: /نية|النية|بداية جديدة/, mood: 'calm',
            scenes: ['mosque-dawn', 'forest-sun', 'mountain-lake'], hadith: 'intention', ambient: 'birds', stickers: ['sunrise'],
            lines: ['Start with an intention', 'Make it for Allah', 'Small deeds, sincere hearts', 'Bismillah'],
            arLines: ['ابدأ بنية', 'اجعلها لله', 'عمل قليل بقلب صادق', 'بسم الله'] },
        { id: 'speech', en: /\bspeech\b|\btongue\b|backbit|speak good|\bwords\b/, ar: /اللسان|الغيبة|الكلام الطيب/, mood: 'calm',
            scenes: ['mountain-lake', 'sea-sunset'], hadith: 'speech', ambient: 'wind', stickers: ['speech'],
            lines: ['Guard your tongue', 'Say what is good', 'Or stay silent', 'Your words are written'],
            arLines: ['احفظ لسانك', 'قل خيرًا', 'أو اصمت', 'كلماتك مكتوبة'] },
        { id: 'wedding', en: /wedding|\bnikk?ah\b|marriage|married|walima|engage/, ar: /زواج|زفاف|نكاح|عرس|خطوبة/, mood: 'elegant',
            paint: 'paper', verse: '30:21', stickers: ['heart', 'flower'],
            lines: ['Barakallahu lakuma', 'Two hearts, one journey', 'May Allah bless you both', 'With love and du‘a'],
            arLines: ['بارك الله لكما', 'قلبان ودرب واحد', 'وجمع بينكما في خير', 'مع خالص الدعاء'] },
        { id: 'nature', en: /\bnature\b|creation|\bsky\b|mountains?|sunset|sunrise|forest|beautiful world/, ar: /طبيعة|خلق|السماء|جبال|غروب|شروق|غابة/, mood: 'calm',
            scenes: ['mountain-lake', 'sea-sunset', 'forest-sun', 'desert-dusk'], verse: '55:13', ambient: 'birds', stickers: ['mountains'],
            lines: ['SubhanAllah', 'Look at the sky, the sea and the mountains', 'Every detail made with care', 'Reflect on His signs'],
            arLines: ['سبحان الله', 'انظر إلى السماء والبحر والجبال', 'كل شيء خُلق بقدر', 'تفكّر في آياته'] },
        { id: 'birthday', en: /birthday|\bb-?day\b/, ar: /عيد ميلاد|ميلاد/, mood: 'festive', paint: 'pastel', stickers: ['balloon', 'gift'], end: 'success',
            lines: ['Happy Birthday!', 'Another year of blessings', 'Wishing you health, joy and success', 'Have a wonderful day'],
            arLines: ['عيد ميلاد سعيد', 'عام جديد مليء بالبركة', 'أتمنى لك الصحة والسعادة والنجاح', 'يومًا رائعًا'] },
        { id: 'graduation', en: /graduat|diploma|\bdegree\b|passed (my|the|her|his) exams?/, ar: /تخرج|شهادة/, mood: 'festive', paint: 'spotlight', stickers: ['trophy', 'star'], end: 'success',
            lines: ['Congratulations, graduate!', 'All the hard work paid off', 'This is only the beginning', 'So proud of you'],
            arLines: ['مبارك التخرج', 'تعبك لم يضِع', 'وهذه مجرد البداية', 'فخورون بك'] },
        { id: 'baby', en: /new ?born|\bbaby\b|aqiqah|welcome (our|the) (little|baby)/, ar: /مولود|طفل جديد|عقيقة/, mood: 'festive', paint: 'pastel', stickers: ['heart', 'star'], end: 'ding',
            lines: ['Welcome to the world', 'A new little blessing', 'May Allah make them righteous', 'With love from the family'],
            arLines: ['أهلًا بك في الدنيا', 'نعمة صغيرة جديدة', 'جعله الله من الصالحين', 'مع حب العائلة'] },
        { id: 'motivation', en: /motivat|\bgoals?\b|\bdreams?\b|success|never give up|\bhustle|\bgym\b|workout|discipline|inspir/, ar: /تحفيز|هدف|حلم|نجاح|لا تستسلم|إلهام/, mood: 'energetic',
            paint: 'spotlight', stickers: ['trophy'], end: 'boom',
            lines: ['Never give up', 'Small steps every day', 'Discipline beats motivation', 'Start today'],
            arLines: ['لا تستسلم', 'خطوات صغيرة كل يوم', 'الانضباط يتفوق على الحماس', 'ابدأ اليوم'] },
        { id: 'travel', en: /\btravel|\btrip\b|journey|vacation|holiday|\btour\b/, ar: /سفر|رحلة|عطلة|إجازة/, mood: 'energetic', paint: 'sunny', stickers: ['pin'],
            lines: ['My trip', 'Places we went', 'Moments to remember', 'Follow for part 2'],
            arLines: ['رحلتي', 'أماكن زرناها', 'لحظات لا تُنسى', 'تابعوني للجزء الثاني'] },
        { id: 'business', en: /\bshop\b|\bstore\b|\bsales?\b|discount|\boffers?\b|% off|business|products?\b|launch|opening|order now|restaurant|\bmenu\b|brand/, ar: /متجر|محل|تخفيض|عرض|خصم|منتج|افتتاح|مطعم/,
            mood: 'bright', paint: 'spotlight', stickers: ['bell', 'thumbs'], end: 'ding',
            lines: ['BIG NEWS', 'Something new is here', 'Don’t miss it', 'Order today'],
            arLines: ['خبر رائع', 'شيء جديد وصل', 'لا تفوّته', 'اطلب اليوم'] },
        { id: 'event', en: /\bevents?\b|invit|join us|conference|halaqa|lecture|seminar|class starts|webinar/, ar: /دعوة|محاضرة|فعالية|حلقة|ندوة/, mood: 'bright',
            paint: 'spotlight', stickers: ['calendar', 'mic'], end: 'ding',
            lines: ['You are invited', 'Join us', 'Bring your family and friends', 'See you there'],
            arLines: ['أنتم مدعوون', 'انضموا إلينا', 'أحضروا عائلاتكم وأصدقاءكم', 'نراكم هناك'] },
        { id: 'thanks', en: /thank you|\bthanks\b|appreciat/, ar: /شكرا|شكرًا|جزاك الله/, mood: 'festive', paint: 'pastel', stickers: ['heart'], end: 'ding',
            lines: ['Thank you', 'For everything you do', 'Jazakallahu khayran', 'We appreciate you'],
            arLines: ['شكرًا لك', 'على كل ما تقدّمه', 'جزاك الله خيرًا', 'نقدّرك كثيرًا'] },
        { id: 'food', en: /recipe|\bcook|\bfood\b|\bdish\b|\bbak(e|ing)\b|kitchen|\bmeal\b/, ar: /وصفة|طبخ|طعام|أكل|مطبخ/, mood: 'bright', paint: 'paper', stickers: ['tea'], end: 'ding',
            lines: ['Let’s cook!', 'Simple, fresh and tasty', 'Step by step', 'Bismillah — enjoy!'],
            arLines: ['هيا نطبخ', 'بسيط وطازج ولذيذ', 'خطوة بخطوة', 'بسم الله — بالهناء'] },
        { id: 'animals', en: /\banimals?\b|\bzoo\b|\bfarm\b|\bkids\b|\bchildren\b|\bjungle\b|\bwild\b/, ar: /حيوان|حيوانات|حديقة الحيوان|مزرعة|أطفال|غابة/, mood: 'kids',
            paint: 'sunny', animals: ['lion', 'cat', 'cow', 'sheep'], stickers: ['star'], end: 'success',
            lines: ['Let’s meet the animals!', 'Who made all these animals? Allah!'],
            arLines: ['هيا نتعرّف على الحيوانات', 'من خلق كل هذه الحيوانات؟ الله'] }
    ];

    /** How each mood looks and sounds. Several title designs, so "another version" can change the look. */
    const MOODS = {
        calm: { titles: ['gold', 'arabic-gold', 'caption'], body: 'gold', transition: 'crossfade', look: 'warm', motions: ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'], cut: null },
        festive: { titles: ['gold', 'comic', 'hook'], body: 'caption', transition: 'iris', look: 'golden', motions: ['zoom-in', 'zoom-out'], cut: null },
        energetic: { titles: ['hook', 'comic', 'caption'], body: 'words', transition: 'zoom', look: 'vivid', motions: ['zoom-in', 'pan-left', 'zoom-out', 'pan-right'], cut: 'whoosh' },
        bright: { titles: ['hook', 'label', 'comic'], body: 'label', transition: 'push', look: 'vivid', motions: ['zoom-in', 'pan-right'], cut: 'whoosh' },
        kids: { titles: ['comic', 'hook', 'pastel'], body: 'pastel', transition: 'slide', look: 'vivid', motions: ['zoom-in', 'zoom-out'], cut: 'pop' },
        elegant: { titles: ['gold', 'arabic-gold'], body: 'gold', transition: 'blur', look: 'golden', motions: ['zoom-in', 'pan-left'], cut: null },
        neon: { titles: ['neon-pink', 'neon-blue'], body: 'neon-blue', transition: 'zoom', look: 'night', motions: ['zoom-in', 'pan-right'], cut: 'whoosh' }
    };
    const MOOD_WORDS = [
        ['calm', /\b(calm|peaceful|soft|gentle|relax(ing)?|quiet|soothing|emotional)\b/, /هادئ|هدوء|ناعم|مؤثر/],
        ['energetic', /\b(energetic|exciting|hype|fast|dynamic|trend(y|ing)?|viral|epic)\b/, /حماس|سريع|ترند/],
        ['kids', /\b(fun|funny|cute|playful|cartoon|for kids|children)\b/, /مضحك|لطيف|للأطفال/],
        ['elegant', /\b(elegant|classy|luxur(y|ious)|premium)\b/, /فخم|أنيق|راق/],
        ['neon', /\bneon\b/, /نيون/],
        ['festive', /\b(celebrat|party|festive|happy)\w*/, /احتفال|حفلة|سعيد/]
    ];
    const DESIGN_WORDS = [
        ['gold', /\bgold(en)?\b/, /ذهبي/], ['neon-pink', /\bneon\b|\bpink\b/, /نيون|وردي/], ['hook', /\byellow\b|\bbold\b|\bbig\b/, /أصفر|عريض|كبير/],
        ['comic', /\bcomic\b|\bcartoon\b/, /كرتون/], ['highlight', /\bhighlight/, /تظليل/], ['note', /\btypewriter\b/, /آلة كاتبة/], ['caption', /\bwhite\b|\bsimple\b/, /أبيض|بسيط/]
    ];

    /* -------------------------------------------------------------- helpers */
    function rng(seed) {
        let s = (Math.abs(Math.floor(seed || 0)) % 2147483646) + 1;
        return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    }
    const AR = /[\u0600-\u06FF]/;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
    function matches(text, pair) { return pair[0].test(text) || pair[1].test(text); }

    function detectShape(t) {
        if (/\b(reels?|shorts?|tiktok|status|stor(y|ies)|vertical|portrait|9:16|whatsapp|snapchat)\b/.test(t) || /عمودي|ريلز|تيك ?توك|حالة|ستوري|شورتس/.test(t)) return 'tall';
        if (/\b(square|1:1)\b|instagram post|feed post/.test(t) || /مربع/.test(t)) return 'square';
        if (/\b(youtube|landscape|horizontal|16:9|widescreen|wide|tv)\b/.test(t) || /يوتيوب|أفقي/.test(t)) return 'wide';
        return null;
    }
    function detectSeconds(t) {
        let m = t.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:s|sec|secs|seconds?|ث|ثانية|ثوان|ثواني)(?![a-z])/);
        if (m) return clamp(Number(m[1]), 5, 180);
        m = t.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:min|mins|minutes?|دقيقة|دقائق)(?![a-z])/);
        if (m) return clamp(Number(m[1]) * 60, 5, 180);
        if (/\b(a|one) minute\b|دقيقة واحدة/.test(t)) return 60;
        if (/half a minute|نصف دقيقة/.test(t)) return 30;
        return null;
    }
    function detectAll(t, table) { return Object.keys(table).filter((k) => matches(t, table[k])); }
    function detectTopic(t) {
        let best = null, score = 0;
        TOPICS.forEach(function (topic, i) {
            const re = new RegExp(topic.en.source, 'g');
            const ar = new RegExp(topic.ar.source, 'g');
            const n = (t.match(re) || []).length + (t.match(ar) || []).length;
            if (n > score || (n && n === score && best && i < TOPICS.indexOf(best))) { best = topic; score = n; }
        });
        return best;
    }
    const INSTRUCTION = /^\s*(please\s+)?(can you|could you|would you|make|create|generate|build|produce|design|do|give me|i want|i need|i'?d like|help me|turn|show|edit|put|add)\b/i;
    const INSTRUCTION_AR = /^\s*(من فضلك\s*)?(اصنع|أنشئ|انشئ|اعمل|سوّ|سو|صمم|أريد|اريد|ممكن|حوّل|حول|ضع|أضف)/;
    // Words that describe a video rather than being its words.
    const DESCRIBES = /\b(video|reel|reels|short|shorts|clip|status|post|story|tiktok|youtube|instagram|facebook|whatsapp|slideshow|montage|sounds?|music|template|for kids|about|reminder|greeting|intro|edit|vertical|square|landscape)\b/;
    const DESCRIBES_AR = /فيديو|ريلز|مقطع|حالة|عن\s|صوت|أصوات|تذكير|تهنئة|قالب/;
    const NOT_NAMES = /^(Allah|Ramadan|Ramadhan|Eid|Friday|Jumu|YouTube|Youtube|TikTok|Tiktok|Instagram|Facebook|Reels?|Shorts?|Mecca|Makkah|Hajj|Umrah|Quran|Qur|Laylat|My|Our|The|A|An|Me|Us|Him|Her|Them|Kids|Children|Mom|Mum|Dad|Mother|Father|Parents?|Family|Everyone|All|Friends?)$/;

    /** Who it is for and who it is from, when the request names them ("Eid Mubarak from Amina", "for Ahmed"). */
    function names(text) {
        const out = {};
        const from = text.match(/\bfrom\s+([A-Z][\w'’-]+(?:\s+(?:and|&)\s+[A-Z][\w'’-]+)?(?:\s+family)?)/);
        if (from && !NOT_NAMES.test(from[1].split(/\s/)[0])) out.from = from[1];
        const to = text.match(/\b(?:birthday|congratulations|congrats|for|to|dear)\s*,?\s+(?:my\s+(?:\w+\s+)?)?([A-Z][\w'’-]+)/);
        if (to && !NOT_NAMES.test(to[1]) && (!out.from || out.from.indexOf(to[1]) !== 0)) out.to = to[1];
        return out;
    }

    /** Words the person wrote themselves: "quoted", or after "saying:". */
    function ownWords(text) {
        const quoted = [];
        const re = /["“«]([^"”»]{2,300})["”»]/g;
        let m;
        while ((m = re.exec(text))) quoted.push(m[1].trim());
        if (quoted.length) return quoted;
        m = text.match(/\b(?:saying|that says|which says|with the (?:words|text)|the text|text)\s*[:\-–]\s*([\s\S]+)$/i) || text.match(/(?:يقول|بعبارة|النص)\s*[:\-–]\s*([\s\S]+)$/);
        return m ? [m[1].trim()] : [];
    }
    /** Breaks a passage into screen-sized lines. */
    function splitLines(text) {
        const out = [];
        String(text).split(/\n+|\s\|\s/).forEach(function (para) {
            (para.match(/[^.!?؟।…]+[.!?؟।…]*/g) || []).forEach(function (s) {
                const t = s.trim();
                if (!t) return;
                if (words(t) <= 14) { out.push(t); return; }
                const parts = t.split(/,\s+|،\s*|;\s+/);
                let cur = '';
                parts.forEach(function (p) {
                    if (cur && words(cur + ' ' + p) > 12) { out.push(cur); cur = p; } else cur = cur ? cur + ', ' + p : p;
                });
                if (cur) out.push(cur);
            });
        });
        return out.slice(0, 14);
    }
    /** What the video is about when the topic is new to the assistant: "make a reel about my new bakery with my photos" → "My new bakery". */
    function subject(text) {
        let s = text.replace(INSTRUCTION, '').replace(INSTRUCTION_AR, '');
        s = s.replace(/^\s*(me\s+)?(an?\s+|the\s+)?((short|quick|nice|beautiful|cool|simple|small|little|new|great|\d+[- ]?(s|sec|second|minute)s?)\s+)*(video|reel|short|clip|status|post|story|tiktok|slideshow|montage|intro|edit)s?\b/i, '');
        s = s.replace(/^\s*(about|on|of|for|showing|from|with)\s+/i, '').replace(/^\s*(عن|حول|ل)\s*/, '');
        s = s.split(/\s+(?:with|using|in|for (?:youtube|tiktok|instagram|facebook|reels?|shorts?|whatsapp)|that|and add)\b|\s+\d+\s*(?:s|sec|seconds?|min|minutes?)\b|[,.!?]|\s+مع\s+/i)[0].trim();
        if (!s.replace(/\b(my|our|the|and|own|all|these|those|photos?|pictures?|images?|videos?|clips?|sounds?|music|audio|voice|files?|songs?)\b|&/gi, '').trim()) return '';
        if (!s) return '';
        s = s.slice(0, 48);
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    /* -------------------------------------------------------------- planner */

    /**
     * Reads a request and decides what to make.
     * `req` = { prompt, media: [{ type: 'image'|'video'|'audio', name, duration }], shape?, seconds?, voice?, lang?, mood?, design?,
     *           ambient? ('' for none), animals?, writing?, seed?, extra? [lines] }.
     * Returns the content: { lang, shape, seconds|null, mood, topic, title, slots: [{ role, text, arabic, meaning, ref, animal, speak }],
     *   scenes|paint, design: { title, body }, ambient, animals, writing, stickers, cut, end, transition, look, motions, voice, notes }.
     */
    function plan(req) {
        const r = Object.assign({ prompt: '', media: [] }, req);
        const raw = String(r.prompt || '').trim();
        const t = raw.toLowerCase();
        const lang = r.lang || (AR.test(raw) && raw.replace(/[^\u0600-\u06FF]/g, '').length > raw.replace(/[^A-Za-z]/g, '').length ? 'ar' : 'en');
        const rand = rng((r.seed || 0) * 7919 + 13);
        const visuals = r.media.filter((m) => m.type === 'image' || m.type === 'video');
        const audio = r.media.filter((m) => m.type === 'audio');
        const notes = [];

        // "from the family" says who it is from, not what it is about.
        let topic = detectTopic(t.replace(/\bfrom\s+(the\s+|my\s+|our\s+)?[\w'’ -]+$/, ''));
        const literal = ownWords(raw);
        const asked = INSTRUCTION.test(raw) || INSTRUCTION_AR.test(raw) || DESCRIBES.test(t) || DESCRIBES_AR.test(raw);
        const who = names(raw);
        // A passage that is not an instruction is the person's own words ("Our shop opens Friday. 20% off.").
        const passage = !literal.length && !asked && raw && (words(raw) >= 7 || /[.!?؟]\s*\S/.test(raw)) ? [raw] : [];
        const own = literal.length ? literal : passage;

        let mood = r.mood || (MOOD_WORDS.find((m) => matches(t, m.slice(1))) || [])[0] || (topic ? topic.mood : (visuals.length ? 'energetic' : 'calm'));
        if (!MOODS[mood]) mood = 'calm';
        const M = MOODS[mood];
        const slots = [];
        let title = '';
        const ar = lang === 'ar';

        if (own.length) {
            const lines = [];
            own.forEach((p) => splitLines(p).forEach((l) => lines.push(l)));
            lines.forEach((l, i) => slots.push({ role: i ? 'line' : 'title', text: l }));
            title = lines[0] || '';
            notes.push(ar ? 'استخدمت كلماتك كما كتبتها' : 'Used your own words as written');
        } else if (topic) {
            const lines = (ar ? topic.arLines : topic.lines).slice();
            if (topic.id === 'birthday' && who.to) lines[0] = ar ? 'عيد ميلاد سعيد يا ' + who.to : 'Happy Birthday, ' + who.to + '!';
            if (topic.id === 'graduation' && who.to) lines[0] = ar ? 'مبارك التخرج يا ' + who.to : 'Congratulations, ' + who.to + '!';
            if (topic.id === 'animals') {
                const asked = detectAll(t, ANIMALS);
                const list = (asked.length ? asked : topic.animals).slice(0, 8);
                const sound = { en: ' says hello!', ar: '' };
                slots.push({ role: 'title', text: lines[0] });
                list.forEach((a) => slots.push({ role: 'animal', animal: a, text: ar ? ANIMAL_NAMES[a][1] : 'The ' + ANIMAL_NAMES[a][0].toLowerCase() + sound.en }));
                slots.push({ role: 'end', text: lines[1] });
            } else {
                slots.push({ role: 'title', text: lines[0] });
                lines.slice(1, -1).forEach((l) => slots.push({ role: 'line', text: l }));
                slots.push({ role: 'end', text: lines[lines.length - 1] });
            }
            title = lines[0];
            notes.push(ar ? 'كتبت كلمات عن: ' + lines[0] : 'Wrote the words about “' + lines[0] + '”');
        } else {
            const s = subject(raw);
            const animalsOnly = detectAll(t, ANIMALS);
            if (animalsOnly.length) {
                topic = TOPICS.find((x) => x.id === 'animals');
                mood = r.mood || 'kids';
                slots.push({ role: 'title', text: ar ? 'أصوات الحيوانات' : 'Animal sounds' });
                animalsOnly.slice(0, 8).forEach((a) => slots.push({ role: 'animal', animal: a, text: ar ? ANIMAL_NAMES[a][1] : 'The ' + ANIMAL_NAMES[a][0].toLowerCase() + ' says hello!' }));
                slots.push({ role: 'end', text: ar ? 'سبحان الله' : 'SubhanAllah!' });
                title = slots[0].text;
            } else {
                title = s || (visuals.length ? (ar ? 'لحظات جميلة' : 'Moments') : (ar ? 'فيديو جديد' : 'My video'));
                slots.push({ role: 'title', text: title });
                if (visuals.length > 2) slots.push({ role: 'end', text: ar ? 'شكرًا للمشاهدة' : 'Thanks for watching' });
                else if (!visuals.length) slots.push({ role: 'end', text: ar ? 'تابعونا للمزيد' : 'Follow for more' });
                notes.push(ar ? 'لم أعرف الموضوع، فصنعت عنوانًا من كلماتك — ضع الكلمات بين علامتي تنصيص لاختيارها بنفسك' :
                    'I made a title from your words — put the exact words in "quotes" to choose every line yourself');
            }
        }
        if (Array.isArray(r.extra)) r.extra.forEach((l) => { if (String(l).trim()) slots.splice(Math.max(1, slots.length - (slots[slots.length - 1].role === 'end' ? 1 : 0)), 0, { role: 'line', text: String(l).trim() }); });

        // A verse or hadith that fits the topic, after the opening line.
        const topicMood = topic && MOODS[mood];
        if (topic && !own.length && (topic.verse || topic.hadith) && !/\bno (verse|ayah|quran|hadith)\b/.test(t)) {
            const v = topic.verse ? VERSES[topic.verse] : HADITH[topic.hadith];
            const ref = topic.verse ? (ar ? 'القرآن ' : 'Qur’an ') + topic.verse : v[2];
            slots.splice(Math.min(2, slots.length - 1), 0, { role: 'verse', text: v[0], arabic: v[0], meaning: ar ? '' : v[1], ref: ref });
            notes.push(topic.verse ? (ar ? 'أضفت آية ' + topic.verse : 'Added Qur’an ' + topic.verse) : (ar ? 'أضفت حديثًا (' + v[2] + ')' : 'Added a hadith (' + v[2] + ')'));
        }
        if (who.from && topicMood) {
            const endIdx = slots.findIndex((s) => s.role === 'end');
            const from = ar ? 'من ' + who.from : 'From ' + who.from;
            if (endIdx >= 0) slots[endIdx].sub = from; else slots.push({ role: 'end', text: from });
        }
        slots.forEach(function (s) { s.speak = s.role === 'verse' ? (s.meaning || '') : s.text + (s.sub ? '. ' + s.sub : ''); });

        // Shape, length, look.
        const shape = r.shape || detectShape(t) || 'tall';
        let seconds = r.seconds || detectSeconds(t) || null;
        if (!seconds && audio.length && audio[0].duration >= 6) {
            seconds = Math.min(audio[0].duration, 120);
            notes.push(ar ? 'جعلت طول الفيديو على قدر صوتك' : 'Made the video as long as your sound');
        }
        const design = { title: r.design || (MOOD_WORDS.some((m) => m[0] === 'neon' && matches(t, m.slice(1))) ? 'neon-pink' : null), body: null };
        const dw = DESIGN_WORDS.find((d) => matches(t, d.slice(1)));
        if (!design.title && dw) design.title = dw[0];
        const Mm = MOODS[mood];
        design.title = design.title || Mm.titles[Math.floor(rand() * Mm.titles.length) % Mm.titles.length];
        design.body = r.design || (dw ? dw[0] : Mm.body);
        if (design.title === 'arabic-gold' && !ar) design.title = 'gold';

        // Pictures behind the words.
        let scenes = null, paint = null;
        if (!visuals.length) {
            if (topic && topic.scenes) {
                const k = Math.floor(rand() * topic.scenes.length);
                scenes = topic.scenes.slice(k).concat(topic.scenes.slice(0, k));
            } else paint = (topic && topic.paint) || (mood === 'neon' ? 'neon' : mood === 'kids' ? 'sunny' : mood === 'elegant' ? 'paper' : mood === 'bright' ? 'spotlight' : ['ink', 'pastel', 'spotlight', 'sunny'][Math.floor(rand() * 4)]);
        }

        // Sounds.
        let ambient = r.ambient !== undefined ? r.ambient : (detectAll(t, NATURE_WORDS)[0] || null);
        const explicitAmbient = !!ambient && r.ambient === undefined;
        if (ambient === null && topic && topic.ambient && !audio.length && !/\b(no|without) (sound|music|audio)\b|\bsilent\b|بدون صوت/.test(t)) ambient = topic.ambient;
        if (/\b(no|without) (sound|music|audio|nature)\b|\bsilent\b|بدون صوت/.test(t)) ambient = '';
        const animals = (r.animals || detectAll(t, ANIMALS)).filter((a) => !slots.some((s) => s.animal === a)).slice(0, 6);
        let writing = r.writing !== undefined ? r.writing : (/\bchalk|blackboard/.test(t) || /طباشير|سبورة/.test(t) ? 'chalk' : /\btyp(e|ing|ed)\b|keyboard/.test(t) || /كتابة على لوحة|لوحة المفاتيح/.test(t) ? 'typing' :
            /\bpencil|handwrit|written by hand/.test(t) || /قلم رصاص|بخط اليد/.test(t) ? 'pencil' : (topic && topic.writing && !own.length) ? topic.writing : null);
        if (writing && WRITING.indexOf(writing) === -1) writing = null;
        const voice = r.voice !== undefined ? !!r.voice : /\b(voice(-| )?over|read (it )?(out )?aloud|narrat\w*|voice)\b/.test(t) || /بصوت|تعليق صوتي|اقرأ/.test(t);

        if (visuals.length) notes.push(ar ? 'استخدمت ' + visuals.length + ' من صورك وفيديوهاتك' : 'Used your ' + visuals.length + ' picture' + (visuals.length > 1 ? 's and videos' : ' or video'));
        if (audio.length) notes.push(ar ? 'وضعت صوتك تحت الفيديو' : 'Put your sound under the video' + (audio.length > 1 ? ' (the first one; the others are in Media)' : ''));

        return {
            lang: lang, shape: shape, seconds: seconds, mood: mood, topic: topic ? topic.id : null, title: title, slots: slots,
            scenes: scenes, paint: paint, design: design, ambient: ambient || null, explicitAmbient: explicitAmbient, animals: animals, writing: writing,
            stickers: topic && topic.stickers ? topic.stickers.slice(0, 2) : [], cut: Mm.cut, end: topic && topic.end ? topic.end : null,
            transition: Mm.transition, look: Mm.look, motions: Mm.motions, voice: voice, notes: notes, music: audio.length ? 0 : null
        };
    }

    /* --------------------------------------------------------------- layout */

    function naturalLength(s) {
        if (s.role === 'title') return clamp(1.8 + words(s.text) * 0.3, 2.6, 4.8);
        if (s.role === 'verse') return clamp(3 + (words(s.arabic) + words(s.meaning)) * 0.32, 5, 9);
        if (s.role === 'animal') return 2.8;
        if (s.role === 'end') return clamp(2 + words(s.text) * 0.25, 2.8, 4.5);
        return clamp(1.4 + words(s.text) * 0.36, 2.8, 6.5);
    }

    /**
     * Times everything: `media` = the request's media (with durations), `spans` = when each slot's words are spoken, if read aloud.
     * Returns { total, slots: [{ at, len }], visuals: [{ kind: 'media'|'scene'|'paint', index|name, at, len, in }], sounds: [{ kind, at, len, volume, slot }] }.
     */
    function layout(c, media, spans, lead) {
        const L = lead || 0.4;
        const list = media || [];
        const vis = list.map((m, i) => Object.assign({ index: i }, m)).filter((m) => m.type === 'image' || m.type === 'video');
        let lens = c.slots.map(naturalLength);
        if (spans && spans.length === c.slots.length) {
            lens = c.slots.map(function (s, i) {
                const start = i ? L + spans[i].start - 0.15 : 0;
                const end = i < spans.length - 1 ? L + spans[i + 1].start - 0.15 : L + spans[i].end + 0.9;
                return Math.max(naturalLength(s) * 0.5, end - start);
            });
        }
        let total = lens.reduce((a, b) => a + b, 0);
        const visualNatural = vis.reduce((a, m) => a + (m.type === 'video' ? Math.min(m.duration || 4, 20) : 2.8), 0);
        let target = c.seconds || (spans ? total : Math.max(total, Math.min(visualNatural, 120)));
        if (spans) target = Math.max(target, total);
        let k = target / total;
        // Over your own pictures the words need not fill every second: they keep a readable length and spread out.
        if (vis.length && !spans && k > 1.6) k = 1.6;
        lens = lens.map((l) => l * k);
        const used = lens.reduce((a, b) => a + b, 0);
        const gap = lens.length > 1 ? Math.max(0, target - used) / (lens.length - 1) : 0;
        total = target;
        let at = 0;
        const slots = lens.map(function (len) { const s = { at: at, len: len }; at += len + gap; return s; });

        const visuals = [];
        if (!vis.length) {
            const names = c.scenes || [c.paint || 'ink'];
            slots.forEach(function (s, i) { visuals.push({ kind: c.scenes ? 'scene' : 'paint', name: names[i % names.length], at: s.at, len: s.len }); });
            // One painted background for the whole video when it is a single painting.
            if (!c.scenes) visuals.splice(0, visuals.length, { kind: 'paint', name: names[0], at: 0, len: total });
        } else {
            const nat = vis.map((m) => (m.type === 'video' ? Math.min(m.duration || 4, 20) : 2.8));
            const sum = nat.reduce((a, b) => a + b, 0);
            let t = 0, carry = 0, i = 0, guard = 0;
            const offset = {};
            while (t < total - 0.05 && guard < 400) {
                guard += 1;
                const m = vis[i % vis.length];
                let want = nat[i % vis.length] * total / sum + carry;
                carry = 0;
                if (i >= vis.length) want = nat[i % vis.length]; // a second pass, when the length is longer than everything given
                want = Math.min(want, total - t);
                let len = want, from = 0;
                if (m.type === 'video') {
                    from = offset[m.index] || 0;
                    const left = Math.max(0, (m.duration || want) - from);
                    if (left < 0.3) { from = 0; len = Math.min(want, m.duration || want); } else len = Math.min(want, left);
                    offset[m.index] = from + len;
                    if (len < want && i < vis.length - 1) carry = want - len;
                }
                if (len < 0.05) break;
                // A sliver at the end goes to the picture before it.
                if (visuals.length && total - t - len < 0.01 && len < 1.2 && i >= vis.length) { visuals[visuals.length - 1].len += len; t += len; break; }
                visuals.push({ kind: 'media', index: m.index, at: t, len: len, in: from });
                t += len;
                i += 1;
            }
            if (visuals.length && t < total - 0.05) visuals[visuals.length - 1].len += total - t;
        }

        const sounds = [];
        if (c.ambient) sounds.push({ kind: c.ambient, at: 0, len: total, volume: c.music !== null ? 0.25 : 0.45 });
        c.slots.forEach(function (s, i) { if (s.animal) sounds.push({ kind: s.animal, at: slots[i].at + 0.35, volume: 0.9, slot: i }); });
        const lineSlots = slots.filter((s, i) => i > 0);
        (c.animals || []).forEach(function (a, i) {
            const s = lineSlots.length ? lineSlots[i % lineSlots.length] : slots[0];
            sounds.push({ kind: a, at: s.at + 0.5 + Math.floor(i / Math.max(1, lineSlots.length)) * 1.2, volume: 0.85 });
        });
        if (c.cut) visuals.slice(1, 14).forEach((v) => sounds.push({ kind: c.cut, at: Math.max(0, v.at - 0.25), volume: 0.45 }));
        if (c.end && slots.length > 1) sounds.push({ kind: c.end, at: slots[slots.length - 1].at + 0.2, volume: 0.6 });
        return { total: Math.round(total * 100) / 100, slots: slots, visuals: visuals, sounds: sounds };
    }

    /* ---------------------------------------------------------- refinements */

    /**
     * Turns a follow-up ("make it longer", "add rain", "gold text", "another version")
     * into changes to the last request. Returns { req, changed: [what], fresh } —
     * `fresh` when the message is a new idea rather than a change.
     */
    function refine(prev, message, lastTotal) {
        const raw = String(message || '').trim();
        const t = raw.toLowerCase();
        const req = Object.assign({}, prev);
        const changed = [];
        const set = (k, v, label) => { req[k] = v; changed.push(label); };
        const ar = AR.test(raw);
        const secs = detectSeconds(t);
        if (secs) set('seconds', secs, (ar ? 'المدة ' : 'length ') + secs + (ar ? ' ث' : ' s'));
        else if (/\b(longer|slower|more time)\b|أطول|أبطأ/.test(t)) set('seconds', Math.round(Math.min(180, (lastTotal || 15) * 1.5)), ar ? 'أطول' : 'longer');
        else if (/\b(shorter|faster|quicker|less time)\b|أقصر|أسرع/.test(t)) set('seconds', Math.round(Math.max(5, (lastTotal || 15) * 0.65)), ar ? 'أقصر' : 'shorter');
        const shape = detectShape(t);
        if (shape) set('shape', shape, { tall: '9:16', square: '1:1', wide: '16:9' }[shape]);
        if (/\b(no|without|remove|stop)\b.*\b(sound|nature|background sound|ambient)\b|\bsilent\b|بدون صوت|احذف الصوت/.test(t)) set('ambient', '', ar ? 'بدون أصوات طبيعة' : 'no nature sound');
        const nat = detectAll(t, NATURE_WORDS);
        if (nat.length) set('ambient', nat[0], nat[0]);
        const animals = detectAll(t, ANIMALS);
        if (animals.length && !/\b(no|without|remove)\b/.test(t)) set('animals', Array.from(new Set((prev.animals || []).concat(animals))), animals.join(', '));
        if (animals.length && /\b(no|without|remove)\b/.test(t)) set('animals', (prev.animals || []).filter((a) => animals.indexOf(a) === -1), (ar ? 'بدون ' : 'no ') + animals.join(', '));
        const mood = MOOD_WORDS.find((m) => matches(t, m.slice(1)));
        if (mood && mood[0] !== 'neon') set('mood', mood[0], mood[0]);
        const dw = DESIGN_WORDS.find((d) => matches(t, d.slice(1)));
        if (dw) set('design', dw[0], dw[0] + (ar ? ' للنص' : ' text'));
        if (/\b(no|without|remove|stop)\b.*\b(voice|narration)\b/.test(t) || /بدون صوت القراءة|بدون تعليق/.test(t)) set('voice', false, ar ? 'بدون قراءة' : 'no voice');
        else if (/\b(voice(-| )?over|read (it )?(out )?aloud|narrat\w*|add (a )?voice)\b/.test(t) || /اقرأه|بصوت|تعليق صوتي/.test(t)) set('voice', true, ar ? 'قراءة بصوت' : 'read aloud');
        if (/\b(in )?arabic\b|بالعربية|عربي/.test(t)) set('lang', 'ar', ar ? 'بالعربية' : 'Arabic words');
        else if (/\b(in )?english\b|بالإنجليزية|انجليزي/.test(t)) set('lang', 'en', ar ? 'بالإنجليزية' : 'English words');
        if (/\bchalk|blackboard\b|طباشير/.test(t)) set('writing', 'chalk', ar ? 'صوت الطباشير' : 'chalk sound');
        else if (/\btyp(e|ing)\b|keyboard|لوحة المفاتيح/.test(t)) set('writing', 'typing', ar ? 'صوت الكتابة' : 'typing sound');
        else if (/\bpencil\b|قلم رصاص/.test(t)) set('writing', 'pencil', ar ? 'صوت القلم' : 'pencil sound');
        if (/\b(another|different|again|new version|try again|shuffle|redo|change (it|the look))\b|غيّر|غير الشكل|نسخة أخرى|مرة أخرى/.test(t)) set('seed', (prev.seed || 0) + 1, ar ? 'نسخة أخرى' : 'another version');
        const add = raw.match(/^\s*(?:add|also say|include)\s+(?:the\s+)?(?:line|text|words?)\s*[:\-–]?\s*["“«]?([^"”»]+)["”»]?\s*$/i) || raw.match(/^\s*(?:أضف|اكتب)\s+(?:سطر|نص|جملة)\s*[:\-–]?\s*(.+)$/);
        if (add) set('extra', (prev.extra || []).concat([add[1].trim()]), (ar ? 'أضفت: ' : 'added: ') + add[1].trim());
        const fresh = Object.assign({}, prev, { prompt: raw, seed: 0, extra: [], mood: undefined, design: undefined, ambient: undefined, animals: undefined,
            writing: undefined, lang: undefined, seconds: undefined, shape: undefined, voice: undefined, fresh: true });
        // A change starts like one ("make it…", "add…", "longer"); anything else that reads like a new idea starts again.
        const modifier = /^\s*(please\s+)?(make it|make the|make them|add|also|change|remove|more|less|longer|shorter|use|put|set|turn|with|without|no\b|another|try|again|in\b|gold|neon|faster|slower|louder|quieter|read)/i.test(raw) ||
            /^\s*(اجعل|اجعله|أضف|اضف|غيّر|غير|احذف|أطول|أقصر|بدون|مع|نسخة|اقرأ)/.test(raw);
        if (!add && !modifier && (ownWords(raw).length || detectTopic(t) || words(raw) > 5 || !changed.length)) return { req: fresh, changed: [], fresh: true };
        return { req: req, changed: changed, fresh: false };
    }

    /** What the assistant can use, for "what can you do?". */
    function abilities(lang, o) {
        const voice = !o || o.voice !== false;
        return abilityList(lang).filter((l) => voice || !/Read the words aloud|قراءة الكلمات بصوت/.test(l));
    }
    function abilityList(lang) {
        if (lang === 'ar') {
            return ['أكتب الكلمات وأصنع الفيديو كاملًا من وصفك',
                'أستخدم صورك وفيديوهاتك وصوتك إن أضفتها، مع حركة وانتقالات ومظهر لوني',
                TOPICS.length + ' موضوعًا: رمضان، العيد، الجمعة، الحج، الصبر، الشكر، الذكر، العلم، الوالدين، الزواج، عيد الميلاد، التخرج، المتاجر، الرحلات، الحيوانات…',
                'آيات قرآنية قصيرة وأحاديث مع المرجع',
                SCENES.length + ' مشهدًا مرسومًا و' + DESIGNS.length + ' تصميمًا للنص وملصقات متحركة',
                'أصوات الطبيعة والمؤثرات و' + Object.keys(ANIMALS).length + ' صوت حيوان وصوت الطباشير والقلم والكتابة',
                'قراءة الكلمات بصوت (الإنجليزية ولغات أخرى)', 'المقاس 9:16 أو 1:1 أو 16:9',
                'بعدها قل: أطول، أقصر، أضف مطرًا، نص ذهبي، نسخة أخرى، بالعربية…'];
        }
        return ['Write the words and build the whole video from what you describe',
            'Use your own pictures, videos and sound if you add them — with movement, transitions and a colour look',
            TOPICS.length + ' topics I know well: Ramadan, Eid, Jumu‘ah, Hajj, patience, gratitude, dhikr, knowledge, parents, weddings, birthdays, graduation, shops, travel, animals…',
            'Short Qur’an verses and hadith, with the reference on screen',
            SCENES.length + ' painted scenes, ' + DESIGNS.length + ' text designs and animated stickers',
            'Nature sounds, sound effects, ' + Object.keys(ANIMALS).length + ' animal sounds, and chalk, pencil or keyboard sounds as words are written',
            'Read the words aloud (English and other languages)', 'Any shape: 9:16, 1:1 or 16:9',
            'Afterwards just say: longer, shorter, add rain, gold text, another version, in Arabic…'];
    }

    /** A plan from a connected language model, kept to what the editor has. */
    function sanitize(x, base) {
        const c = Object.assign({}, base);
        if (!x || typeof x !== 'object') return c;
        const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 160);
        if (Array.isArray(x.slots) && x.slots.length) {
            c.slots = x.slots.slice(0, 16).map(function (s) {
                const role = ['title', 'line', 'verse', 'end', 'animal'].indexOf(s && s.role) !== -1 ? s.role : 'line';
                const o = { role: role, text: str(s && (s.text || s.arabic), 200) };
                if (role === 'animal' && ANIMALS[s.animal]) o.animal = s.animal; else if (role === 'animal') o.role = 'line';
                if (role === 'verse') { o.arabic = str(s.arabic || s.text, 300); o.meaning = str(s.meaning, 240); o.ref = str(s.ref, 60); o.text = o.arabic; }
                if (s.sub) o.sub = str(s.sub, 80);
                o.speak = role === 'verse' ? o.meaning : o.text;
                return o;
            }).filter((s) => s.text);
            if (!c.slots.length) c.slots = base.slots;
        }
        if (MOODS[x.mood]) { c.mood = x.mood; Object.assign(c, { transition: MOODS[x.mood].transition, look: MOODS[x.mood].look, motions: MOODS[x.mood].motions, cut: MOODS[x.mood].cut }); }
        if (['tall', 'square', 'wide'].indexOf(x.shape) !== -1) c.shape = x.shape;
        if (Number(x.seconds) >= 5 && Number(x.seconds) <= 180) c.seconds = Number(x.seconds);
        if (Array.isArray(x.scenes)) { const s = x.scenes.filter((n) => SCENES.indexOf(n) !== -1); if (s.length) { c.scenes = s; c.paint = null; } }
        if (PAINTS.indexOf(x.paint) !== -1 && !(Array.isArray(x.scenes) && x.scenes.length)) { c.paint = x.paint; c.scenes = null; }
        if (x.design && DESIGNS.indexOf(x.design.title) !== -1) c.design = Object.assign({}, c.design, { title: x.design.title });
        if (x.design && DESIGNS.indexOf(x.design.body) !== -1) c.design = Object.assign({}, c.design, { body: x.design.body });
        if (x.ambient === null || x.ambient === '' || NATURE.indexOf(x.ambient) !== -1) c.ambient = x.ambient || null;
        if (Array.isArray(x.animals)) c.animals = x.animals.filter((a) => ANIMALS[a]).slice(0, 6);
        if (x.writing === null || WRITING.indexOf(x.writing) !== -1) c.writing = x.writing;
        if (Array.isArray(x.stickers)) c.stickers = x.stickers.filter((s) => STICKERS.indexOf(s) !== -1).slice(0, 3);
        if (x.end === null || EFFECTS.indexOf(x.end) !== -1) c.end = x.end;
        if (typeof x.title === 'string' && x.title.trim()) c.title = str(x.title, 80);
        if (Array.isArray(x.notes)) c.notes = x.notes.map((n) => str(n, 140)).slice(0, 6);
        return c;
    }

    /** What the assistant can use, for a connected model to choose from. */
    const CATALOG = { SCENES, PAINTS, NATURE, EFFECTS, WRITING, STICKERS, DESIGNS, MOODS: Object.keys(MOODS), ANIMALS: Object.keys(ANIMALS), VERSES: Object.keys(VERSES) };

    const EXAMPLES = [
        ['A 20-second Reel about patience with rain sounds', 'ريلز 20 ثانية عن الصبر مع صوت المطر'],
        ['Eid Mubarak video from Amina', 'فيديو عيد مبارك'],
        ['Jumu‘ah reminder for WhatsApp status', 'تذكير الجمعة لحالة واتساب'],
        ['Animal sounds for kids: lion, cat, cow, sheep and camel', 'أصوات الحيوانات للأطفال: أسد وقطة وبقرة وجمل'],
        ['Happy birthday Ahmed from the family', 'عيد ميلاد سعيد'],
        ['Our shop opens on Friday. 20% off everything this week!', 'افتتاح متجرنا يوم الجمعة. خصم 20% هذا الأسبوع'],
        ['Make a video with my photos and my sound', 'اصنع فيديو من صوري وصوتي'],
        ['Seek knowledge — chalk writing, YouTube 16:9', 'اطلب العلم مع صوت الطباشير']
    ];

    return { plan, layout, refine, abilities, sanitize, names, subject, splitLines, ownWords, detectShape, detectSeconds, detectTopic, TOPICS, MOODS, VERSES, HADITH, ANIMALS, ANIMAL_NAMES, CATALOG, EXAMPLES };
}));

/* ------------------------------------------------------- the editor side */
(function () {
    'use strict';
    if (typeof window === 'undefined' || !window.ReelApp) return;
    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const A = window.ReelAI;

    const SIZES = { tall: [1080, 1920], square: [1080, 1080], wide: [1920, 1080] };
    const VOICE_FOR = { en: 'eng', ar: null };

    // One conversation per page: the last request, what it built, and what was on the timeline before.
    const chat = { log: [], req: null, content: null, base: null, made: new Set(), files: [], ids: [], built: null };
    const mark = (p) => JSON.stringify(p.clips) + p.width + 'x' + p.height;

    /** Whether this site offers spoken voice-overs (a host can switch Read aloud off). */
    function canVoice() { return !!(window.ReelSpeak && window.ReelSpeak.speak) && !(app.config.features && app.config.features.readAloud === false); }

    /**
     * The greeting: what the assistant does for free on this device, the tools for
     * real editing of your own recordings, and what Pro adds (when the site sells it).
     */
    function welcome(open, onTool) {
        const ar = uiLang() === 'ar';
        const section = function (title, kids) {
            return el('details', { className: 'ai-guide', open: open ? '' : null }, [el('summary', { text: title })].concat(kids));
        };
        const free = section(say('✓ Free, right now — made on your device', '✓ مجانًا الآن — يُصنع على جهازك'), [el('ul', null, (ar ? [
            'أكتب الكلمات وأصنع الفيديو كاملًا من جملة واحدة، بالعربية أو الإنجليزية',
            'أستخدم صورك وفيديوهاتك وصوتك: حركة وانتقالات وصوتك تحت الفيديو',
            A.TOPICS.length + ' موضوعًا: رمضان، العيد، الجمعة، الحج، التذكير، أعياد الميلاد، الزواج، المتاجر، الرحلات، الأطفال…',
            'آيات وأحاديث مع المرجع، مشاهد مرسومة، تصاميم نص، أصوات الطبيعة والحيوانات',
            'ثم غيّره بكلمة: أطول، أضف مطرًا، نص ذهبي، نسخة أخرى…'
        ] : [
            'Write the words and make a whole video from one sentence — in English or Arabic',
            'Use your photos, videos and sound: movement, transitions, your sound underneath',
            A.TOPICS.length + ' topics: Ramadan, Eid, Jumu‘ah, Hajj, reminders, birthdays, weddings, shops, travel, kids…',
            'Verses and hadith with references, painted scenes, text designs, nature and animal sounds',
            'Then change it with a word: longer, add rain, gold text, another version…'
        ]).map((t) => el('li', { text: t })))]);
        const tool = (label, labelAr, re) => el('button', { type: 'button', className: 'ghost', text: ar ? labelAr : label, onclick: function () { onTool(re); } });
        const real = section(say('🎬 For real editing of your own videos', '🎬 لتحرير فيديوهاتك الحقيقية'), [
            el('p', { text: say('I make new videos. To edit a recording you already have, these tools do the heavy work:', 'أنا أصنع فيديوهات جديدة. لتحرير تسجيل عندك، هذه الأدوات تقوم بالعمل الشاق:') }),
            el('div', { className: 'ai-tools' }, [
                el('button', { type: 'button', className: 'ghost', text: say('📥 Import my video', '📥 استورد الفيديو'), onclick: function () { onTool(null); } }),
                tool('Auto captions', 'ترجمة تلقائية', /^Auto captions/),
                tool('Cut pauses & jump cuts', 'قص الوقفات', /pauses & jump cuts/),
                tool('Follow the face for Shorts', 'تتبّع الوجه للشورتس', /Auto-reframe/),
                tool('Make a Short', 'اصنع شورت', /Make a Short/),
                tool('Remove background', 'إزالة الخلفية', /Remove \/ replace background/)
            ]),
            el('small', { text: say('Select a sound clip and press Clean up voice to remove noise. Trim, split and arrange anything on the timeline.', 'حدّد مقطعًا صوتيًا واضغط «تنظيف الصوت» لإزالة الضجيج. قص وقسّم ورتّب أي شيء على الخط الزمني.') })
        ]);
        const kids = [free, real];
        if (app.config.upgrade) {
            const prices = (window.NOOR_CONFIG && window.NOOR_CONFIG.prices) || {};
            const cost = [prices.monthly && prices.monthly.label, prices.yearly && prices.yearly.label].filter(Boolean).join(say(' or ', ' أو '));
            const text = el('p', { text: (cost ? cost + ' — ' : '') + say('videos without the watermark, priority help, and new Pro tools as they arrive — including a smarter online AI that writes about any topic, in any language.',
                'فيديوهات بدون العلامة المائية، ودعم أولوية، وأدوات Pro الجديدة فور صدورها — ومنها ذكاء اصطناعي أذكى عبر الإنترنت يكتب عن أي موضوع وبأي لغة.') });
            const go = el('button', { type: 'button', className: 'ai-pro', text: say('⭐ See Pro', '⭐ اعرف المزيد عن Pro'), onclick: function () { app.config.upgrade('ai'); } });
            const pro = section(say('⭐ NoorEditor Pro', '⭐ نور إديتور Pro'), [text, el('div', { className: 'ai-tools' }, [go])]);
            kids.push(pro);
            app.refreshPlan().then(function (isPro) {
                if (!isPro || !app.config.canRemoveWatermark) return;
                text.textContent = say('You have Pro — thank you! Your videos export without the watermark, and new Pro tools come to you first.', 'لديك Pro — شكرًا لك! فيديوهاتك تُصدَّر بدون العلامة المائية، وتصلك أدوات Pro الجديدة أولًا.');
                go.remove();
            });
        }
        return el('div', { className: 'ai-msg ai ai-welcome' }, [
            el('strong', { text: say('✨ AI', '✨ الذكاء الاصطناعي') }),
            el('p', { text: say('Assalamu alaikum! I’m the NoorEditor AI. Here is what I can do:', 'السلام عليكم! أنا مساعد نور إديتور. هذا ما أستطيع فعله:') })
        ].concat(kids, [el('p', { className: 'ai-ask', text: say('Tell me what video you want, or tap an example below. Add photos, videos or sound with 📎.', 'قل لي ما الفيديو الذي تريده، أو اختر مثالًا بالأسفل. أضف صورًا أو فيديوهات أو صوتًا عبر 📎.') })]));
    }

    function uiLang() { return window.ReelI18n && window.ReelI18n.lang() === 'ar' ? 'ar' : 'en'; }
    const say = (en, ar) => (uiLang() === 'ar' ? ar : en);

    async function toFile(canvas, name) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        return new File([blob], name + '.png', { type: 'image/png', lastModified: Date.now() });
    }

    function wavFile(data, name) {
        const wav = window.ReelAudio.encodeWav([data], window.ReelSounds.RATE);
        return new File([wav], name + '.wav', { type: 'audio/wav', lastModified: Date.now() });
    }

    /** Places an audio clip on the first audio track free at that time, adding one if needed. */
    function placeAudio(p, mediaId, at, look) {
        const media = T.getMedia(p, mediaId);
        const len = (look && look.duration) || media.duration;
        let track = p.tracks.filter((t) => t.kind === 'audio').find((t) => T.isFree(p, t.id, at, len, null));
        if (!track) {
            const id = T.nextTrackId(p, 'audio');
            p = T.addTrack(p, 'audio', 'AI sounds');
            track = T.getTrack(p, id);
        }
        return T.addClip(p, Object.assign(T.clipFromMedia(media, track.id, at), look));
    }

    /** Speaks the words of every slot; resolves to { file, spans } or null. */
    async function voiceOver(content, status) {
        const S = window.ReelSpeak;
        const code = VOICE_FOR[content.lang];
        if (!S || !S.speak || !code) return null;
        const lines = content.slots.map((s) => s.speak || ' ');
        const out = await S.speak(lines.map((l) => S.prepare(code, l)), S.models(code), function (d) {
            if (d.status === 'speaking') status(say('Reading it aloud… ' + (d.done + 1) + ' of ' + d.total, 'أقرأ الكلمات… ' + (d.done + 1) + ' من ' + d.total));
            else if (d.progress) status(say('Getting the voice ready (downloads once)…', 'أجهّز الصوت (يُنزَّل مرة واحدة)…'));
        });
        const joined = S.joinParts(out.parts, out.rate, 0.45);
        const wav = window.ReelAudio.encodeWav([joined.audio], out.rate);
        return { file: new File([wav], 'AI voice-over – ' + content.title.slice(0, 30) + '.wav', { type: 'audio/wav', lastModified: Date.now() }), spans: joined.spans };
    }

    /**
     * Builds `content` (from ReelAI.plan) on the timeline, after what is there.
     * `mediaIds` are the person's own files, in the order the plan counts them.
     */
    async function build(content, mediaIds, status) {
        const S = window.ReelSounds, R = window.ReelTrends, O = window.ReelOccasions;
        app.pause();
        status = status || function () {};
        let p = app.state.project;
        if (!p.clips.length) {
            const size = SIZES[content.shape] || SIZES.tall;
            const q = T.clone(p);
            [q.width, q.height] = size;
            q.name = content.title.slice(0, 60) || 'AI video';
            state(q);
            p = app.state.project;
        }
        const W = p.width, H = p.height, tall = H > W;
        const media = mediaIds.map((id) => T.getMedia(app.state.project, id)).filter(Boolean);

        let spans = null, voiceId = null;
        if (content.voice) {
            try {
                const v = await voiceOver(content, status);
                if (v) { voiceId = (await app.importFiles([v.file], { noCommit: true, fresh: true, origin: 'speak' }))[0]; spans = v.spans; }
            } catch (err) { content.notes.push(say('The voice could not load (' + err.message + '), so the video has no voice-over', 'تعذّر تحميل الصوت، فالفيديو بدون قراءة')); }
        }
        const L = A.layout(content, media.map((m) => ({ type: m.type, duration: m.duration })), spans, 0.4);
        const start = T.projectDuration(app.state.project);

        // Painted backgrounds and synthesised sounds become media first (no undo step of their own).
        status(say('Painting the scenes…', 'أرسم المشاهد…'));
        const paintIds = {};
        for (const v of L.visuals) {
            if (v.kind === 'media' || paintIds[v.name]) continue;
            const canvas = v.kind === 'scene' ? O.paintScene(v.name, W, H) : R.paint(v.name, W, H);
            paintIds[v.name] = (await app.importFiles([await toFile(canvas, 'AI ' + v.name.replace(/-/g, ' '))], { noCommit: true, fresh: true }))[0];
        }
        status(say('Making the sounds…', 'أصنع الأصوات…'));
        const soundIds = [];
        for (const s of L.sounds) {
            const kind = s.kind;
            const seconds = S.NATURE[kind] ? Math.ceil(s.len) + 1 : undefined;
            const data = S.synth(kind, seconds);
            const label = (S.NATURE[kind] || (S.EFFECTS[kind] || S.ANIMALS[kind] || [kind])[0]);
            soundIds.push((await app.importFiles([wavFile(data, label)], { noCommit: true, fresh: true }))[0]);
        }

        p = T.clone(app.state.project);
        const tracks = {};
        const track = function (key, type, name) {
            if (tracks[key]) return tracks[key];
            const id = T.nextTrackId(p, type);
            p = T.addTrack(p, type, 'AI · ' + name);
            return (tracks[key] = id);
        };
        // Pictures.
        L.visuals.forEach(function (v, i) {
            const at = start + v.at;
            if (v.kind !== 'media') {
                const m = T.getMedia(p, paintIds[v.name]);
                if (!m) return;
                const bg = Object.assign(T.clipFromMedia(m, track('bg', 'video', 'background'), at), { // adds the track to p first
                    duration: v.len, fit: 'cover', transition: i ? { type: content.transition, duration: 0.5 } : null,
                    motion: v.len > 2 ? { type: content.motions[i % content.motions.length], amount: 0.06 } : null
                });
                p = T.addClip(p, bg);
                return;
            }
            const m = media[v.index];
            if (!m) return;
            const c = Object.assign(T.clipFromMedia(m, track('bg', 'video', 'your pictures'), at), {
                duration: v.len, fit: 'cover', bgFill: 'blur',
                transition: i && L.visuals[i - 1].index !== v.index ? { type: content.transition, duration: 0.4 } : null
            });
            if (m.type === 'video') { c.in = v.in || 0; c.muted = content.music !== null || !!voiceId; }
            else c.motion = { type: content.motions[i % content.motions.length], amount: 0.12 };
            p = T.addClip(p, c);
            if (content.look && content.look !== 'none' && T.applyLook) p = T.applyLook(p, c.id, content.look);
        });

        // Words.
        const R2 = window.ReelTrends;
        const over = media.some((m) => m.type !== 'audio');
        const titleIds = [];
        content.slots.forEach(function (s, i) {
            const slot = L.slots[i];
            const at = start + slot.at + (i ? 0.15 : 0.1);
            const len = Math.max(1, slot.len - 0.3);
            const arabic = /[\u0600-\u06FF]/.test(s.text);
            const readable = over ? { outline: { width: 4, color: '#000000' }, shadow: true } : {};
            const add = function (key, text, design, patch) {
                const c = Object.assign(T.textClip(track(key, 'text', key), at, text), { duration: len, fadeIn: 0.2, fadeOut: 0.3, x: 0.5 }, R2.designPatch(design, tall), patch);
                if (/[\u0600-\u06FF]/.test(text) && !(window.ReelApp.FONTS[c.font] || {}).arabic) c.font = 'amiri';
                // Plain lettering gets a soft dark halo so it reads on bright skies and suns.
                if (!c.box && !c.glow && !(c.outline && c.outline.width)) Object.assign(c, { glow: '#000000', outline: { width: 2, color: '#2b1d0e' } });
                p = T.addClip(p, c);
                return c;
            };
            if (s.role === 'verse') {
                const box = { box: false, outline: { width: over ? 4 : 0, color: '#000000' }, shadow: true };
                add('words', s.arabic, 'arabic-gold', Object.assign({ y: s.meaning ? 0.4 : 0.47, fontSize: tall ? 52 : 60, anim: 'fade' }, box));
                if (s.meaning) add('meaning', s.meaning, 'gold', Object.assign({ y: 0.6, fontSize: tall ? 30 : 34, italic: true, anim: 'rise' }, box));
                if (s.ref) add('ref', s.ref, 'caption', { y: tall ? 0.78 : 0.82, fontSize: tall ? 20 : 22, outline: { width: 3, color: '#000000' }, anim: 'fade', color: '#f2d27a' });
                return;
            }
            const design = s.role === 'title' || s.role === 'end' || s.role === 'animal' ? content.design.title : content.design.body;
            const y = s.role === 'title' || s.role === 'end' || s.role === 'animal' ? 0.45 : (over ? (tall ? 0.76 : 0.84) : 0.5);
            const patch = Object.assign({ y: y }, readable, arabic && design === 'gold' ? { font: 'amiri', italic: false } : {});
            if (s.role !== 'title' && s.role !== 'end' && s.role !== 'animal') patch.fontSize = (tall ? 40 : 46);
            if (i === 0 && content.writing) Object.assign(patch, content.writing === 'typing' ? { anim: 'typewriter' } : { anim: 'handwrite', hand: 'pen', handStyle: 'realistic', writeDuration: Math.min(3.2, len * 0.8) });
            const c = add(s.role === 'title' || s.role === 'end' ? 'title' : 'words', s.text, design, patch);
            if (i === 0) titleIds.push(c);
            if (s.sub) add('sub', s.sub, 'caption', { y: 0.62, fontSize: tall ? 30 : 34, anim: 'rise', fadeIn: 0.3 });
        });

        // Stickers on the opening title.
        (content.stickers || []).forEach(function (kind, j) {
            const s = L.slots[0];
            const c = Object.assign(T.drawClip(track('deco', 'text', 'stickers'), start + s.at + 0.3, []), {
                duration: Math.max(1, s.len - 0.4), anim: 'pop', hand: 'none', x: j ? 0.8 : 0.5, y: j ? 0.78 : 0.2, scale: tall ? 0.36 : 0.3,
                sticker: { kind: kind, motion: j ? 'float' : 'pulse', color: content.mood === 'kids' ? '#ffe14d' : '#f2d27a', rotation: 0 }
            });
            p = T.addClip(p, c);
        });

        // Sound: the person's own first, then the voice, then the made sounds.
        const audio = mediaIds.map((id) => T.getMedia(p, id)).filter((m) => m && m.type === 'audio');
        if (content.music !== null && audio[0]) p = placeAudio(p, audio[0].id, start, { duration: Math.min(audio[0].duration, L.total), fadeOut: 1.5, volume: voiceId ? 0.35 : 1 });
        if (voiceId) p = placeAudio(p, voiceId, start + 0.4, { volume: 1 });
        L.sounds.forEach(function (s, i) {
            const id = soundIds[i];
            if (!id) return;
            const look = { volume: s.volume };
            if (S.NATURE[s.kind]) Object.assign(look, { duration: Math.min(T.getMedia(p, id).duration, L.total), fadeIn: 1, fadeOut: 1.5 });
            p = placeAudio(p, id, start + s.at, look);
        });
        // The writing sound under the title, timed to its letters.
        if (content.writing && titleIds[0]) {
            const c = T.getClip(p, titleIds[0].id);
            const times = c ? T.revealTimes(c) : [];
            if (times.length) {
                const data = S.writingSound(content.writing, T.revealSpan(c) + 0.3, times);
                const id = (await app.importFiles([wavFile(data, S.WRITING[content.writing] + ' — ' + content.title.slice(0, 24))], { noCommit: true, fresh: true }))[0];
                const fresh = T.clone(app.state.project);
                const m = fresh.media.find((x) => x.id === id);
                if (m && !p.media.some((x) => x.id === id)) p = T.addMedia(p, m);
                p = placeAudio(p, id, c.start, { volume: 0.8 });
            }
        }
        app.apply(p);
        app.zoomToFit();
        app.seek(start + 0.5);
        return { from: start, to: start + L.total, layout: L, voice: !!voiceId };
    }

    // Sets the project without an undo step (the build that follows makes one).
    function state(q) { app.state.project = q; }

    /** Asks the host's language model for a plan, when one is connected. */
    async function remotePlan(req, local) {
        const cfg = (app.config && app.config.ai) || (window.REEL_CONFIG && window.REEL_CONFIG.ai) || null;
        if (!cfg || !cfg.endpoint) return local;
        try {
            const r = await fetch(cfg.endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: req.prompt, media: req.media, lang: local.lang, draft: local, catalog: A.CATALOG })
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return A.sanitize(await r.json(), local);
        } catch (err) {
            local.notes.push(say('The online assistant did not answer, so I planned it on this device', 'لم يُجب المساعد عبر الإنترنت، فخطّطت الفيديو على هذا الجهاز'));
            return local;
        }
    }

    /* --------------------------------------------------------------- dialog */
    function open() {
        app.pause();
        const ar = uiLang() === 'ar';
        const log = el('div', { className: 'ai-log lang-keep', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
        const prompt = el('textarea', { rows: 3, className: 'ai-prompt', 'aria-label': 'Describe your video', placeholder: 'Describe your video… e.g. “A 20-second Reel about patience with rain sounds”' });
        const fileInput = el('input', { type: 'file', multiple: true, accept: 'image/*,video/*,audio/*', hidden: true });
        const fileList = el('div', { className: 'ai-files' });
        const shape = el('select', { 'aria-label': 'Shape' }, [['', 'Shape: let the AI choose'], ['tall', '9:16 · Reels, Shorts, TikTok, status'], ['square', '1:1 · Instagram post'], ['wide', '16:9 · YouTube']].map((o) => el('option', { value: o[0], text: o[1] })));
        const length = el('select', { 'aria-label': 'Length' }, [['', 'Length: let the AI choose'], ['10', '10 seconds'], ['15', '15 seconds'], ['30', '30 seconds'], ['60', '1 minute']].map((o) => el('option', { value: o[0], text: o[1] })));
        const voice = el('input', { type: 'checkbox' });
        const chips = el('div', { className: 'sound-chips ai-examples', 'aria-label': 'Examples' }, A.EXAMPLES.map((e) => el('button', { type: 'button', className: 'ghost', text: ar ? e[1] : e[0], onclick: function () { prompt.value = ar ? e[1] : e[0]; prompt.focus(); } })));
        const followups = el('div', { className: 'sound-chips ai-followups', hidden: true });

        function bubble(who, text, list) {
            const b = el('div', { className: 'ai-msg ' + who }, [el('strong', { text: who === 'me' ? say('You', 'أنت') : say('✨ AI', '✨ الذكاء الاصطناعي') }), el('p', { text: text })]);
            if (list && list.length) b.append(el('ul', null, list.map((l) => el('li', { text: l }))));
            log.append(b);
            log.scrollTop = log.scrollHeight;
            chat.log.push({ who: who, text: text, list: list || [] });
        }
        const history = chat.log.splice(0);
        // The guide opens fully the first time; later it stays folded above the conversation.
        log.append(welcome(!history.length, function (re) {
            if (!re) { dialog.close(); const b = document.getElementById('import'); if (b) b.click(); return; }
            // These tools work on a recording that is already on the timeline.
            if (!app.state.project.clips.some((c) => c.type === 'media')) {
                bubble('ai', say('First put your video or recording on the timeline: press 📥 Import my video (or File ▸ Import), then double-click it. Then press that tool again.',
                    'ضع الفيديو أو التسجيل على الخط الزمني أولًا: اضغط «📥 استورد الفيديو» (أو ملف ▸ استيراد) ثم انقر عليه مرتين، ثم اضغط الأداة مرة أخرى.'));
                return;
            }
            dialog.close();
            app.runTool(re);
        }));
        history.forEach((m) => bubble(m.who, m.text, m.list));
        // A first visit reads the guide from its start.
        if (!history.length) setTimeout(() => { log.scrollTop = 0; }, 0);

        function renderFiles() {
            fileList.replaceChildren(...chat.files.map(function (f, i) {
                const icon = /^image/.test(f.type) ? '🖼' : /^video/.test(f.type) ? '🎬' : '🎵';
                return el('span', { className: 'ai-file' }, [icon + ' ' + f.name.slice(0, 28), el('button', { type: 'button', className: 'ghost', text: '×', 'aria-label': 'Remove ' + f.name, onclick: function () { chat.files.splice(i, 1); renderFiles(); } })]);
            }));
        }
        fileInput.onchange = function () { Array.from(fileInput.files || []).forEach((f) => { if (/^(image|video|audio)\//.test(f.type)) chat.files.push(f); }); fileInput.value = ''; renderFiles(); };
        renderFiles();

        function showFollowups() {
            const list = say('Make it longer|Shorter|Add rain|Gold text|Another version|Read it aloud|In Arabic|Square for Instagram', 'أطول|أقصر|أضف مطرًا|نص ذهبي|نسخة أخرى|اقرأه بصوت|بالإنجليزية|مربع لإنستغرام').split('|')
                .filter((f) => canVoice() || !/Read it aloud|اقرأه بصوت/.test(f));
            followups.replaceChildren(...list.map((f) => el('button', { type: 'button', className: 'ghost', text: f, onclick: function () { prompt.value = f; go(); } })));
            followups.hidden = false;
            chips.hidden = true;
        }
        if (chat.content) showFollowups();

        let dialog = null, busy = false;
        async function go() {
            if (busy) return;
            const text = prompt.value.trim();
            const pending = chat.files.slice();
            if (!text && !pending.length) { dialog.status(say('Describe your video, or add photos, videos or sound with 📎.', 'صف الفيديو أو أضف صورًا أو فيديوهات أو صوتًا عبر 📎.')); return; }
            if (/^(what can you do|help|\?|what('?s| is) (available|in there)|ماذا تستطيع|ما الذي تستطيع|مساعدة)/i.test(text)) {
                bubble('me', text);
                prompt.value = '';
                bubble('ai', say('Here is what I can do:', 'هذا ما أستطيع فعله:'), A.abilities(uiLang(), { voice: canVoice() }));
                return;
            }
            busy = true;
            dialog.busy(true);
            bubble('me', (text || say('Make a video with my files', 'اصنع فيديو من ملفاتي')) + (pending.length ? ' 📎 ' + pending.length : ''));
            prompt.value = '';
            try {
                let req, changed = [];
                // A rebuild replaces the AI's last version (Undo brings it back) — unless the
                // timeline was changed by hand since, in which case the new version goes after it.
                if (chat.base && !chat.made.has(mark(app.state.project)) && mark(app.state.project) !== mark(chat.base)) {
                    chat.base = app.state.project;
                    changed.push(say('kept your own changes and added the new version after them', 'أبقيت تعديلاتك وأضفت النسخة الجديدة بعدها'));
                } else if (chat.base) state(T.clone(chat.base));
                // New files join the conversation's own files.
                if (pending.length) {
                    dialog.status(say('Opening your files…', 'أفتح ملفاتك…'));
                    const ids = await app.importFiles(pending, { noCommit: true, fresh: true });
                    chat.ids = chat.ids.concat(ids);
                    chat.files = [];
                    renderFiles();
                }
                chat.base = app.state.project;
                if (chat.req && text) {
                    const r = A.refine(chat.req, text, chat.built ? chat.built.to - chat.built.from : 15);
                    req = r.req; changed = changed.concat(r.changed);
                    // A new idea leaves earlier files in Media unless it asks for them (or brings new ones).
                    if (r.fresh && !pending.length && !/\b(my|our|these|the)\s+(photos?|pictures?|images?|videos?|clips?|sounds?|music|files?)\b|صوري|فيديوهاتي|صوتي|ملفاتي/i.test(text)) chat.ids = [];
                } else req = Object.assign({}, chat.req || {}, { prompt: text || (chat.req && chat.req.prompt) || '' });
                req.media = chat.ids.map((id) => T.getMedia(chat.base, id)).filter(Boolean).map((m) => ({ type: m.type, name: m.name, duration: m.duration }));
                if (shape.value) req.shape = shape.value;
                if (length.value) req.seconds = Number(length.value);
                if (voice.checked) req.voice = true;
                let content = A.plan(req);
                content = await remotePlan(req, content);
                if (content.voice && !canVoice()) { content.voice = false; content.notes.push(say('Reading aloud is not available on this site, so the video has no voice-over — you can record your own voice with Create ▸ Record your voice', 'القراءة بصوت غير متاحة في هذا الموقع، فالفيديو بدون تعليق صوتي — يمكنك تسجيل صوتك من إنشاء ▸ سجّل صوتك')); }
                if (content.voice && !VOICE_FOR[content.lang]) content.notes.push(say('There is no Arabic reading voice yet, so I left the voice out', 'لا يوجد صوت قراءة عربي بعد، فلم أضف القراءة'));
                dialog.status(say('Making your video…', 'أصنع الفيديو…'));
                const built = await build(content, chat.ids, dialog.status);
                chat.req = req; chat.content = content; chat.built = built; chat.made.add(mark(app.state.project));
                const secs = (built.to - built.from).toFixed(1);
                const what = [];
                if (changed.length) what.push(say('Changed: ', 'غيّرت: ') + changed.join(', '));
                content.notes.forEach((n) => what.push(n));
                what.push(say('Shape ', 'المقاس ') + ({ tall: '9:16', square: '1:1', wide: '16:9' }[content.shape] || '') + ' · ' + content.slots.length + say(' scenes · ', ' مشاهد · ') + secs + say(' s', ' ث'));
                if (content.ambient) what.push(say('Nature sound: ', 'صوت الطبيعة: ') + (window.ReelI18n ? window.ReelI18n.tr(window.ReelSounds.NATURE[content.ambient]) : content.ambient));
                const animals = content.slots.filter((s) => s.animal).map((s) => s.animal).concat(content.animals || []);
                if (animals.length) what.push(say('Animal sounds: ', 'أصوات الحيوانات: ') + animals.map((a) => A.ANIMAL_NAMES[a][uiLang() === 'ar' ? 1 : 0]).join(', '));
                if (content.writing) what.push(say('Writing sound under the title: ', 'صوت الكتابة تحت العنوان: ') + content.writing);
                if (built.voice) what.push(say('Read aloud, with the words timed to the voice', 'قراءة بصوت والكلمات متزامنة معها'));
                bubble('ai', say('Done! Your ' + secs + '-second video is on the timeline. Everything is editable — tap any part to change it. Tell me what to change, or press ▶ Watch.',
                    'تم! الفيديو (' + secs + ' ث) على الخط الزمني. كل شيء قابل للتعديل — المس أي جزء لتغييره. قل لي ما أغيّر، أو اضغط ▶ شاهد.'), what);
                showFollowups();
                dialog.status('');
                app.toast(say('AI video ready (' + secs + ' s). One Undo goes back.', 'فيديو الذكاء الاصطناعي جاهز (' + secs + ' ث). تراجع واحد يعيدك.'));
            } catch (err) {
                bubble('ai', say('Sorry, that did not work: ', 'عذرًا، لم ينجح ذلك: ') + err.message);
                dialog.status('');
            }
            busy = false;
            dialog.busy(false);
        }
        prompt.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });

        dialog = app.openDialog({
            title: '✨ AI video maker',
            wide: true,
            body: [log, chips, followups, prompt,
                el('div', { className: 'ai-row' }, [el('button', { type: 'button', className: 'ghost', text: '📎 Add photos, videos or sound', onclick: function () { fileInput.click(); } }), fileInput, fileList]),
                el('details', { className: 'ai-options' }, [el('summary', { text: 'Options' }), shape, length,
                    canVoice() ? el('label', { className: 'check' }, [voice, 'Read the words aloud (English and other languages; the voice downloads once, about 30 MB)']) : null]),
                el('p', { className: 'hint', text: 'Tip: put exact words in "quotes". Ask “what can you do?” to see everything I can use.' })],
            actions: [
                { label: 'Close' },
                { label: '▶ Watch', run: function () { if (chat.built) { app.seek(chat.built.from); app.play(); } return true; } },
                { label: '✨ Make video', primary: true, run: async function () { await go(); return false; } }
            ]
        });
        setTimeout(() => prompt.focus(), 0);
    }

    /** Until the full AI video creator is ready, the button says it is coming soon. */
    function comingSoon() {
        app.pause();
        app.openDialog({
            title: '✨ AI video maker',
            body: [
                el('p', { className: 'ai-soon', text: 'Coming soon, in shā’ Allāh.' }),
                el('p', { text: 'Soon you will describe a video, add your photos, videos and sound, and the AI will make it for you.' }),
                el('p', { className: 'hint', text: 'Until then, Create ▸ Templates, Trending templates and Occasion video make a ready video in a few clicks.' })
            ],
            actions: [
                { label: 'Close' },
                { label: 'Open templates', primary: true, run: function () { setTimeout(() => app.runTool(/^Templates…$/), 0); return true; } }
            ]
        });
    }

    // The assistant is switched on by the host (REEL_CONFIG.features.ai = true) once the full AI creator is in place.
    const ready = !!(app.config.features && app.config.features.ai === true);
    const start = ready ? open : comingSoon;
    app.addTool({ section: 'Create', label: ready ? '✨ AI video maker — describe it, add your photos…' : '✨ AI video maker (coming soon)', run: start });
    // A gold ✨ AI button in the top bar, just before the menus.
    const bar = document.querySelector('.menubar');
    if (bar && !document.getElementById('ai-maker')) {
        const b = el('button', { type: 'button', id: 'ai-maker', className: 'ai-btn', 'aria-label': 'AI video maker', title: ready ? 'AI video maker: describe a video, add your photos, and it is made for you' : 'AI video maker — coming soon', onclick: start },
            [el('span', { text: '✨' }), el('span', { className: 'hide-narrow', text: ' AI' }), ready ? null : el('span', { className: 'ai-soon-badge hide-narrow', text: 'Soon' })]);
        bar.parentNode.insertBefore(b, bar);
    }
    Object.assign(window.ReelAI, { open: start, openAssistant: open, comingSoon, ready, build, chat });
}());
