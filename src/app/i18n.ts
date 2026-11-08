/**
 * User-facing wording in English and Chinese. Core modules return structured data; this file turns
 * it into sentences, so the insight engine stays language-neutral and every string is in one place.
 */
import type { ClusterQuestion } from '../core/insights/cluster';
import type { Gap, Suggestion } from '../core/insights/engine';

export type Locale = 'en' | 'zh';

const en = {
  appName: 'NetNote',
  tagline: 'Lay your notes out around you. Connect them by hand. Write what you see.',
  enterVR: 'Enter VR',
  enterAR: 'Enter mixed reality',
  noXR: 'Open this page in the Meta Quest browser to step inside.',
  loading: 'Opening your notes…',
  vaults: 'Your libraries',
  sample: 'Sample library',
  importZip: 'Import .zip',
  importFolder: 'Import folder',
  exportZip: 'Export .zip',
  newVault: 'New empty library',
  notes: 'notes',
  links: 'links',
  // reading card
  outgoing: 'Links to',
  backlinks: 'Linked from',
  related: 'Possibly related',
  mentions: 'Mentions',
  noLinks: 'Nothing linked yet',
  open: 'Open',
  pin: 'Pin',
  unpin: 'Unpin',
  close: 'Close',
  edit: 'Write',
  toWall: 'To wall',
  linkIt: 'Link',
  focus: 'Focus',
  words: 'words',
  // menu
  menuNew: 'New idea',
  menuSearch: 'Find',
  menuWall: 'Thinking wall',
  menuOverview: 'Insights',
  menuRecenter: 'Recenter',
  menuMap: 'Map in hand',
  menuExit: 'Exit',
  // keyboard / writing
  newNoteTitle: 'New idea',
  typeHere: 'Pinch here to type',
  whyLinked: 'Why are these connected?',
  reasonPlaceholder: 'One line: what links them? (optional)',
  save: 'Save',
  cancel: 'Cancel',
  skip: 'Skip',
  saved: 'Saved',
  linked: 'Linked',
  searchPlaceholder: 'Search notes, #tags',
  noResults: 'No matching notes',
  keyboardHint: 'Quest keyboard, voice or Bluetooth keyboard · pinch the text to move the cursor',
  // wall
  wallEmpty: 'Drag cards here to think with them',
  wallShares: 'They share',
  wallMissing: 'Missing piece?',
  answer: 'Write an answer',
  wallGroup: (n: number) => `${n} notes together`,
  wallLinks: (n: number) => `${n} links inside`,
  wallNoLinks: 'no links inside yet',
  wallHidden: (n: number) => `${n} possible links`,
  wallShared: 'Shared: ',
  wallNoShared: 'No shared topic shows',
  wallThinking: 'Finding what they share…',
  offWall: 'Take down',
  wallHint: 'Your thinking wall is on your left: drag cards there, side by side, to group them',
  answerTitle: 'Your answer',
  insightsTitle: 'What your notes are telling you',
  insightsSummary: (topics: number, links: number, questions: number) => `${topics} topics · ${links} possible links · ${questions} questions`,
  tabLinks: 'Hidden links',
  tabQuestions: 'Questions',
  tabTopics: 'Topics',
  tabWanted: 'Unwritten',
  tabDrifting: 'Drifting',
  hintLinks: 'Not linked yet, but they link to the same notes or use the same ideas.',
  hintQuestions: 'Two topics with almost no links but similar words. The answer is often here.',
  hintTopics: 'Topics found from the links. Bridges hold several topics together.',
  hintWanted: 'Mentioned several times but not written yet.',
  hintDrifting: 'Cut off from everything else. Give them a place.',
  show: 'Show',
  writeIdea: 'Write',
  connectIt: 'Connect',
  dismiss: 'Not related',
  refs: (n: number) => `mentioned in ${n}`,
  closestTo: (n: string) => `closest to “${n}”`,
  islandOf: (n: number) => `${n} notes on their own`,
  bridgeOf: (n: number) => `bridges ${n} topics`,
  topicSize: (n: number) => `${n} notes`,
  allConnected: 'Nothing here right now. Write a few more notes and new findings will appear.',
  between: (a: string, b: string) => `${a} and ${b}`,
  relatedLine: 'Related',
  rename: 'Rename',
  renameTitle: 'New name',
  deleteNote: 'Delete',
  deleteConfirm: 'Delete?',
  deleted: 'Deleted',
  renamed: (n: number) => (n > 1 ? `Renamed, ${n - 1} links updated` : 'Renamed'),
  // exploring
  menuMore: 'More',
  menuTour: 'Tour',
  menuTime: 'Time',
  menuSound: 'Sound',
  menuPet: 'Mochi',
  menuMotion: 'Motion',
  pathTo: 'Path to…',
  editTitle: 'Edit',
  blockOf: (i: number, n: number) => `Block ${i} of ${n} · pinch the box to type`,
  clearBlock: 'Clear',
  addBelow: '+ Below',
  removeBlock: 'Delete',
  editHint: 'Pinch the text to edit anywhere · ⌫ deletes the word before the cursor',
  pathPick: 'Pinch another note to find the way there',
  pathFound: (n: number) => `${n} ${n === 1 ? 'step' : 'steps'} from one to the other`,
  pathNone: 'These two are not connected by any chain of links yet',
  tourOn: 'Touring along your links · pinch anything to stop',
  tourOff: 'Tour stopped',
  timeOn: (date: string, i: number, n: number) => `${date} · ${i} / ${n} notes`,
  timeFew: 'Too few notes to watch them grow',
  timeDone: 'This is how your thinking grew',
  soundOn: 'Sound and haptics on',
  soundOff: 'Sound and haptics off',
  motionOn: 'Motion on',
  motionOff: 'Reduced motion',
  petOn: 'Mochi is back',
  petOff: 'Mochi is resting (More → Mochi to bring it back)',
  // companion
  petName: 'Mochi',
  petShow: 'Show me ✦',
  petWhy: 'Why?',
  petBtnShow: 'Show',
  petBtnConnect: 'Connect',
  petBtnDismiss: 'Not related',
  petDismissed: 'Got it, I will not suggest that again',
  petInsights: 'Open insights',
  petGreet: (h: number): string =>
    h < 5
      ? 'It is late, rest soon'
      : h < 11
        ? 'Good morning! What shall we connect today?'
        : h < 14
          ? 'Hello! Ideas come after lunch'
          : h < 18
            ? 'Good afternoon, let us wander your notes'
            : h < 22
              ? 'Good evening, any new thoughts?'
              : 'Thinking this late? You are brave',
  petFound: (n: number) => ` · ${n} possible ${n === 1 ? 'link' : 'links'} worth a look`,
  petRelated: (a: string, b: string) => `“${a}” and “${b}” seem related`,
  petLonely: 'Nothing links here yet, find it a friend?',
  petLinked: (n: number) => [`Connected! That makes ${n} threads`, 'One more line of thought', 'They finally met!'],
  petSaved: ['Saved ✍️', 'Nicely put', 'Written down'],
  petCreated: ['A new idea is born!', 'Welcome, new note', 'Another seed'],
  petPath: (n: number) => `Found it! ${n} ${n === 1 ? 'step' : 'steps'} from one end to the other`,
  petTime: 'Look, this is how your ideas grew',
  petTour: 'Follow me, a stroll along your links',
  petWake: ['Oh, you are back!', 'I was not asleep… really', 'Welcome back'],
  petAmbientLink: ['I think I found another possible link…', 'Two notes keep looking at each other', 'Want to see what I found?'],
  petWonder: (q: string) => `I wonder: ${q}`,
  petPoke: ['Hehe', 'That tickles', 'I am Mochi!', '♪', 'Let us keep going'],
  petPokeFind: ['Want to see a link I found?', 'I have a discovery!'],
  mrTable: 'Your notes are on your table now. Lean in to read.',
  mrWall: 'Your thinking wall is on the real wall to your left.',
  sources: 'Sources',
  // overview
  topics: 'Topics',
  bridgeNote: 'Bridge between',
  // onboarding
  tipPinch: 'Pinch a star to read it',
  tipDrag: 'Pinch empty space and move your hand to move the room',
  tipTwoHands: 'Pinch with both hands and pull apart to zoom',
  tipConnect: 'Pinch a star and drag it onto another to connect them',
  tipMenu: 'Look down: the menu floats just below your view',
  // insight phrasing
  sharedLinks: (names: string[]) => `both link to ${names.map((n) => `“${n}”`).join(', ')}`,
  sharedTerms: (terms: string[]) => `both talk about ${terms.map((t) => `“${t}”`).join(', ')}`,
  gapNone: (a: string, b: string, terms: string[]) =>
    `“${a}” and “${b}” have no links between them yet.${
      terms.length
        ? ` Both mention ${terms
            .slice(0, 2)
            .map((t) => `“${t}”`)
            .join(' and ')}.`
        : ''
    } Could there be a relation you haven't seen?`,
  gapFew: (a: string, b: string, links: number, terms: string[]) =>
    `“${a}” and “${b}” touch through only ${links} link${links === 1 ? '' : 's'}.${
      terms.length
        ? ` Both involve ${terms
            .slice(0, 2)
            .map((t) => `“${t}”`)
            .join(' and ')}.`
        : ''
    } What do you get if you put the two sides together?`,
  qIncludeNamed: (c: string, k: string) => `This group keeps mentioning “${k}”, yet the note “${c}” isn't here. Bring it in and see what it ties together?`,
  qMissing: (c: string, kw: string[], tied: number, term: string | null) =>
    `This group is about ${kw.map((k) => `“${k}”`).join(' and ')}. “${c}” ${tied >= 2 ? `links to ${tied} of them` : term ? `also talks about “${term}”` : 'is very similar'} but isn't here. Is it the missing piece?`,
  qConclusion: (kw: string[]) => `This group is about ${kw.map((k) => `“${k}”`).join(' and ')}. Can you write their shared conclusion in one sentence?`,
  qRing: (c: string, tied: number) => `No common topic shows, but “${c}” links to ${tied} of these notes. Is it the link that holds them together?`,
  qWhy: 'These notes share no obvious topic. What connection did you see when you put them together?',
  noLinksInGroup: ' (no links inside the group yet)',
  // landing page
  language: '中文',
  openLib: 'Open',
  deleteLib: 'Delete',
  confirmDelete: 'Delete this library from this headset? Export it first if you want to keep it.',
  confirm: 'Delete',
  importing: 'Importing…',
  imported: (n: number) => `Imported ${n} notes`,
  importEmpty: 'No Markdown notes found in that file',
  previewHint: 'Desktop preview: drag to turn the graph, click a star to read, scroll to zoom.',
  devices: 'Works on Meta Quest 3 / 3S / Pro and Meta VR glasses. Hands first, controllers optional.',
  current: 'Open now',
  emptyWelcome: (n: string) => `# ${n}\n\nYour first note. Pinch “New idea” to write another, then drag one star onto another to connect them.\n`,
};

type Dict = typeof en;

const zh: Dict = {
  appName: 'NetNote',
  tagline: '把笔记摊在身边，用手把它们连起来，把看到的写下来。',
  enterVR: '进入 VR',
  enterAR: '进入混合现实',
  noXR: '请在 Meta Quest 浏览器里打开本页，即可走进去。',
  loading: '正在打开你的笔记…',
  vaults: '你的笔记库',
  sample: '示例笔记库',
  importZip: '导入 .zip',
  importFolder: '导入文件夹',
  exportZip: '导出 .zip',
  newVault: '新建空笔记库',
  notes: '篇笔记',
  links: '条链接',
  outgoing: '链接到',
  backlinks: '被链接',
  related: '可能相关',
  mentions: '提到它',
  noLinks: '还没有链接',
  open: '打开',
  pin: '钉住',
  unpin: '取消钉住',
  close: '关闭',
  edit: '写',
  toWall: '上墙',
  linkIt: '连上',
  focus: '聚焦',
  words: '字',
  menuNew: '新想法',
  menuSearch: '查找',
  menuWall: '思考墙',
  menuOverview: '洞察',
  menuRecenter: '回到面前',
  menuMap: '手中地图',
  menuExit: '退出',
  newNoteTitle: '新想法',
  typeHere: '捏一下这里开始输入',
  whyLinked: '它们为什么有关？',
  reasonPlaceholder: '一句话：它们因为什么相连？（可不填）',
  save: '保存',
  cancel: '取消',
  skip: '跳过',
  saved: '已保存',
  linked: '已连上',
  searchPlaceholder: '搜索笔记、#标签',
  noResults: '没有找到',
  keyboardHint: '可用 Quest 键盘、语音或蓝牙键盘输入 · 捏文字可移动光标',
  wallEmpty: '把卡片拖到这里一起想',
  wallShares: '共同点',
  wallMissing: '缺的那一篇？',
  answer: '写下回答',
  wallGroup: (n) => `这一组 ${n} 篇`,
  wallLinks: (n) => `组内链接 ${n}`,
  wallNoLinks: '组内还没有链接',
  wallHidden: (n) => `可能的联系 ${n}`,
  wallShared: '共同话题：',
  wallNoShared: '看不出共同话题',
  wallThinking: '正在找它们的共同点…',
  offWall: '取下',
  wallHint: '思考墙在你的左手边：把卡片拖过去并排放，就成了一组',
  answerTitle: '你的回答',
  insightsTitle: '你的笔记在告诉你什么',
  insightsSummary: (topics, links, questions) => `${topics} 个主题 · ${links} 处可能的联系 · ${questions} 个问题`,
  tabLinks: '隐藏联系',
  tabQuestions: '值得追问',
  tabTopics: '主题',
  tabWanted: '还没写',
  tabDrifting: '漂流',
  hintLinks: '这些笔记还没有互相链接，但链接了相同的笔记、谈到相同的概念。',
  hintQuestions: '两个主题之间几乎没有联系，但用词相近。答案往往就在这里。',
  hintTopics: '根据链接结构分出的主题。桥梁笔记把不同主题串在一起。',
  hintWanted: '多次被提到、但还不存在的笔记。',
  hintDrifting: '和其他内容断开的笔记，给它们找个落脚点。',
  show: '看看',
  writeIdea: '写下想法',
  connectIt: '连起来',
  dismiss: '不相关',
  refs: (n) => `被 ${n} 篇提到`,
  closestTo: (n) => `最接近「${n}」`,
  islandOf: (n) => `${n} 篇自成一团`,
  bridgeOf: (n) => `连接 ${n} 个主题`,
  topicSize: (n) => `${n} 篇`,
  allConnected: '暂时没有发现。多写几篇，这里会出现新的发现。',
  between: (a, b) => `${a} 与 ${b}`,
  relatedLine: '相关',
  rename: '改名',
  renameTitle: '新名字',
  deleteNote: '删除',
  deleteConfirm: '确定删除？',
  deleted: '已删除',
  renamed: (n) => (n > 1 ? `已改名，更新了 ${n - 1} 处链接` : '已改名'),
  menuMore: '更多',
  menuTour: '漫游',
  menuTime: '时光机',
  menuSound: '声音',
  menuPet: '糯糯',
  menuMotion: '动效',
  pathTo: '找路径',
  editTitle: '编辑',
  blockOf: (i, n) => `第 ${i} / ${n} 段 · 捏文本框打字`,
  clearBlock: '清空',
  addBelow: '+ 下方新段',
  removeBlock: '删除此段',
  editHint: '捏文字任意处（或移动键盘光标）即可在那里插入或删改 · ⌫ 删光标前一个词',
  pathPick: '再捏一颗星，看看怎么走过去',
  pathFound: (n) => `从这头到那头，${n} 步`,
  pathNone: '这两篇之间还没有任何链接路径',
  tourOn: '沿着链接漫游中 · 捏任意处停止',
  tourOff: '漫游已停止',
  timeOn: (date, i, n) => `${date} · ${i} / ${n} 篇`,
  timeFew: '笔记太少，还看不出思路的演变',
  timeDone: '你的想法就是这样长出来的',
  soundOn: '声音和震动已开',
  soundOff: '声音和震动已关',
  motionOn: '动效已开',
  motionOff: '已减少动效',
  petOn: '糯糯回来啦',
  petOff: '糯糯去休息了（更多 → 糯糯 可叫回）',
  petName: '糯糯',
  petShow: '带我去看 ✦',
  petWhy: '为什么？',
  petBtnShow: '看看',
  petBtnConnect: '连起来',
  petBtnDismiss: '不相关',
  petDismissed: '好的，不再提这一对了',
  petInsights: '去洞察看看',
  petGreet: (h) =>
    h < 5
      ? '夜深了，记得早点休息哦'
      : h < 11
        ? '早上好！今天想把什么串起来？'
        : h < 14
          ? '中午好～吃饱了才有灵感'
          : h < 18
            ? '下午好！我陪你一起逛笔记'
            : h < 22
              ? '晚上好，今天有什么新想法吗？'
              : '这么晚还在思考，辛苦啦',
  petFound: (n) => `\u3000有 ${n} 处联系值得一看`,
  petRelated: (a, b) => `「${a}」和「${b}」好像有关系哦`,
  petLonely: '还没有笔记链接到这里，要不要给它找个朋友？',
  petLinked: (n) => [`连上啦！我们一起连起了 ${n} 条线`, '又多了一条思路～', '它们终于认识了！'],
  petSaved: ['记下来啦 ✍️', '写得真好', '保存好啦'],
  petCreated: ['新想法诞生！', '欢迎新笔记～', '又一颗种子'],
  petPath: (n) => `找到啦！${n} 步就能从这头走到那头`,
  petTime: '看，你的想法是这样一点点长出来的～',
  petTour: '跟我来，我们沿着链接散散步',
  petWake: ['啊，你回来啦！', '我刚刚没睡着…真的', '欢迎回来～'],
  petAmbientLink: ['我好像又发现了一处可能的联系…', '有两篇笔记一直在偷偷看对方', '要不要看看我找到的东西？'],
  petWonder: (q) => `我在想：${q}`,
  petPoke: ['嘿嘿', '好舒服～', '我是糯糯！', '♪', '今天也一起加油'],
  petPokeFind: ['嘿嘿～要看看我找到的联系吗？', '我有一个发现！'],
  mrTable: '笔记星图已经放到你的桌面上，凑近就能读。',
  mrWall: '思考墙已经贴在你左手边真实的墙上。',
  sources: '来源',
  topics: '主题',
  bridgeNote: '连接了',
  tipPinch: '捏一下星星就能阅读',
  tipDrag: '在空白处捏住并移动手，可以移动整个房间',
  tipTwoHands: '双手同时捏住再拉开，可以缩放',
  tipConnect: '捏住一颗星拖到另一颗上，就能把它们连起来',
  tipMenu: '稍稍低头：菜单就在视线下方',
  sharedLinks: (names) => `都链接了${names.map((n) => `「${n}」`).join('')}`,
  sharedTerms: (terms) => `都谈到${terms.map((t) => `「${t}」`).join('')}`,
  gapNone: (a, b, terms) =>
    `「${a}」和「${b}」两组笔记之间还没有任何链接。${
      terms.length
        ? `它们都谈到了${terms
            .slice(0, 2)
            .map((t) => `「${t}」`)
            .join('')}，`
        : ''
    }它们之间会不会有你还没想到的关系？`,
  gapFew: (a, b, links, terms) =>
    `「${a}」和「${b}」只通过 ${links} 条链接相连。${
      terms.length
        ? `既然都涉及${terms
            .slice(0, 2)
            .map((t) => `「${t}」`)
            .join('')}，`
        : ''
    }能否把两边的想法放在一起，得出新的结论？`,
  qIncludeNamed: (c, k) => `这一组反复提到「${k}」，可「${c}」这篇本身不在组里：要不要把它放进来，看看它把大家串成了什么？`,
  qMissing: (c, kw, tied, term) =>
    `这一组都在谈${kw.map((k) => `「${k}」`).join('')}。「${c}」${tied >= 2 ? `链接了组里 ${tied} 篇` : term ? `也谈到「${term}」` : '和它们很像'}，却不在组里：它是不是缺的那一篇？`,
  qConclusion: (kw) => `这一组都在谈${kw.map((k) => `「${k}」`).join('')}。能用一句话写下它们的共同结论吗？`,
  qRing: (c, tied) => `这几篇看不出共同话题，但「${c}」同时链接了其中 ${tied} 篇：它会是把它们串起来的那一环吗？`,
  qWhy: '这几篇看不出共同的话题。你把它们放在一起，是看到了什么联系？',
  noLinksInGroup: '（组里还没有一条链接）',
  language: 'English',
  openLib: '打开',
  deleteLib: '删除',
  confirmDelete: '要从这台设备上删除这个笔记库吗？想保留的话请先导出。',
  confirm: '删除',
  importing: '正在导入…',
  imported: (n) => `已导入 ${n} 篇笔记`,
  importEmpty: '这个文件里没有找到 Markdown 笔记',
  previewHint: '桌面预览：拖动旋转星图，点击星星阅读，滚轮缩放。',
  devices: '支持 Meta Quest 3 / 3S / Pro 与 Meta VR 眼镜。手势优先，手柄可选。',
  current: '当前',
  emptyWelcome: (n) => `# ${n}\n\n你的第一篇笔记。捏一下“新想法”再写一篇，然后把一颗星拖到另一颗上，把它们连起来。\n`,
};

const DICTS: Record<Locale, Dict> = { en, zh };

export function detectLocale(langs: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages : []): Locale {
  return langs.some((l) => l.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}

let current: Locale = 'en';
export const setLocale = (l: Locale): void => {
  current = l;
};
export const getLocale = (): Locale => current;
export const t = (): Dict => DICTS[current];
export const dict = (l: Locale): Dict => DICTS[l];

/** Why a suggested connection was suggested, in words. */
export function reasonText(s: Suggestion, name: (p: string) => string, l: Locale = current): string {
  const d = DICTS[l];
  const parts: string[] = [];
  if (s.shared.length) parts.push(d.sharedLinks(s.shared.slice(0, 3).map(name)));
  if (s.terms.length) parts.push(d.sharedTerms(s.terms.slice(0, 3)));
  return parts.join(l === 'zh' ? '，' : '; ');
}

export function gapQuestion(g: Gap, l: Locale = current): string {
  const d = DICTS[l];
  return g.links === 0 ? d.gapNone(g.a, g.b, g.terms) : d.gapFew(g.a, g.b, g.links, g.terms);
}

export function clusterQuestion(q: ClusterQuestion, name: (p: string) => string, links: number, l: Locale = current): string {
  const d = DICTS[l];
  let s: string;
  switch (q.kind) {
    case 'include-named':
      s = d.qIncludeNamed(name(q.candidate), q.keyword);
      break;
    case 'missing-piece':
      s = d.qMissing(name(q.candidate), q.keywords, q.tied, q.term);
      break;
    case 'write-conclusion':
      s = d.qConclusion(q.keywords);
      break;
    case 'linking-ring':
      s = d.qRing(name(q.candidate), q.tied);
      break;
    case 'why-together':
      s = d.qWhy;
      break;
  }
  return links ? s : s + d.noLinksInGroup;
}
