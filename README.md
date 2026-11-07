# NetNote

**A VR-native notes app for Meta Quest and Meta VR glasses.** Your Markdown notes (Obsidian
compatible) become a small galaxy around you. Pinch a star to read it, pinch one star and drag it
onto another to connect them, and say *why* with the Quest keyboard or your voice. The app shows you
what your notes are quietly telling you: links you have not made yet, questions between topics,
notes mentioned but never written, notes drifting on their own.

**Try it:** open **https://adminzachary.github.io/NetNote/** in the Meta Quest browser and press
*Enter VR* or *Enter mixed reality*. On a computer the same page shows a 3D preview.

Built with Meta's [Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) (IWSDK 1.0).

> 中文快速上手见文末。

## What you can do in the headset

| | |
|---|---|
| **See** | The graph floats in front of you, coloured by topic. Topic *territories* glow around their notes with a name label; bridge notes get a gold ring. |
| **Read** | Pinch a star: the whole graph turns about its centre to bring it round to you, and its card opens on the reading shelf to your right, with clickable links, backlinks and "possibly related" notes. Pin cards to keep several open. |
| **Move the room** | Pinch empty space and move your hand. Pinch with both hands: pull apart to zoom, turn to rotate. |
| **Connect** | Pinch a star and drag it onto another. A writing card asks *why are these connected?* The answer is written into the note (`## Connections`). |
| **Write** | New idea, rename, delete, and *Edit*: the note opens block by block (paragraphs, headings, lists); pick a block, change it, add one below or remove it, then save. Text comes from the Meta Quest system keyboard, voice dictation or a Bluetooth keyboard. |
| **Think on the wall** | Put cards on the *thinking wall* on your left. Cards placed side by side form a group; the group tells you what they share, which note seems to be missing (pinch it to bring it in) and asks a question. *Write an answer* creates a note linked to the whole group. The wall is saved. |
| **Ask** | *Insights*: hidden links, questions between topics, topics and bridges, unwritten notes, drifting notes. Each row lights up on the graph and offers one action. |
| **Navigate** | *Map in hand*: a 15 cm holographic copy of the graph projected above your left hand. Grab its glowing bezel ring and drag to turn it freely; the big graph turns with it. Point at a note and pinch: the big graph turns it round to face you. *Find* searches notes and `#tags`. |
| **Explore** | *Path to…* on a card, then pinch another note: the shortest chain of links lights up and flows gold. *More → Tour* walks along your links on its own; *More → Time* replays how your notes were born, one by one. |
| **Feel it** | Data flows along the links of the note you read (cyan out, violet in), a thread ties each card to its star, cards glide and grow in. Spatial sound comes from where things happen, with light controller haptics. *More → Motion* (or the system's reduce-motion setting) turns animation off. |
| **Mochi** | A small companion beside the card you read that notices things: two notes that seem related (and why), a question between topics. A gold badge counts what it found; its bubble has *Show*, *Connect* and *Not related*; a poke brings the next one; it falls asleep when you are away and steps aside while you write. *More → Mochi* turns it off. |
| **Mixed reality** | With passthrough, scene understanding finds your real desk (the graph stands on it) and the wall on your left (the thinking wall hangs in front of it). |

Hands first: everything works without controllers (controllers and a mouse work too). Content is
placed by the headset's real field of view, so on the narrow Meta VR glasses (≈74° wide, 25° up /
43° down) the shelf moves to the centre and slides down instead of falling off the edges.

On the 2D page (desktop or the Quest browser before you step in) you choose a library, import a
`.zip` or a folder of Markdown files (an Obsidian vault works as is), export everything back as a
`.zip`, and switch between English and Chinese. Everything stays in the browser (IndexedDB); nothing
is uploaded.

## Run it

NetNote is a pure WebXR web app: people use it from a public HTTPS URL in the Meta Quest browser,
with nothing to install. Node.js 20.19+ is only needed to develop and build it:
`npm install` then `npm run dev`.

The desktop preview opens at `https://localhost:8081/` with the IWSDK emulator (an emulated Quest 3:
press *Enter VR*, then drive hands or controllers from the emulator panel). On the first start the
IWSDK dev tools download a Chromium build once.

**On a Quest headset during development:** same Wi-Fi as the computer, open the Meta Quest browser at the *Network* address
the dev server prints (`https://<computer-ip>:8081/`), accept the certificate warning, press
*Enter VR* or *Enter mixed reality*. (Or with a USB cable: `adb reverse tcp:8081 tcp:8081` and open
`https://localhost:8081/`.)

## Publish

```bash
npm run build      # static site in dist/
```

Upload `dist/` to any HTTPS static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages). WebXR
needs HTTPS. The emulator is not included in the build.

Every push to `main` runs the checks and deploys to GitHub Pages (`.github/workflows/pages.yml`).

## Develop

```bash
npm run check        # typecheck + lint + format check + unit tests
npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end in the emulated Quest 3 (Playwright + IWER)
npm run test:coverage
```

`test:e2e` starts its own dev server on port 8091 (or uses `E2E_URL=https://localhost:8081/` when
one is already running) and drives the real app: desktop preview; an immersive session with emulated
hands (pinch to read, drag to connect, type the reason, reload); the thinking wall (group, missing
piece, answer, restore); insights and the hand map; rename/delete; mixed reality in a synthetic room
with a desk and a wall. If Playwright has no browser yet: `npx playwright install chromium`.

### Layout

```
src/
  core/          pure logic, no DOM, no 3D (fully unit-tested)
    markdown/    front matter, wiki links, tags, headings, word counts (CJK aware)
    vault/       the notes model: Obsidian link resolution, graph, backlinks, search, create,
                 rename (rewrites links), link with a reason, canvas files
    insights/    TF-IDF + CJK bigrams, Louvain topics, Brandes bridges, Adamic-Adar suggestions,
                 gaps between topics, wanted and drifting notes, wall-group analysis
    layout/      deterministic 3D force layout with topic cohesion
  storage/       IndexedDB store, zip/folder import and export
  app/           Library (the only API the UI talks to), i18n (en/zh), insight rows, bootstrap
  web/           the 2D landing page
  xr/            everything spatial
    app.ts       the orchestrator: input, placement, flows
    graph/       instanced stars and links, labels
    ui/          canvas-drawn panels (card, writing card, dock, search, insights)
    keyboard/    Meta Quest system keyboard bridge
    wall/        thinking wall geometry (pure), look, group label
    overview/    topic territories, map in hand
    room/        field of view and shelf placement (pure), sky
    interaction/ one- and two-hand room manipulation (pure maths)
    mr/          picking a real table and wall from detected planes (pure)
test/unit/       Vitest
test/e2e/        Playwright + IWER
sample-vault/    35 notes on learning and memory (first-run library)
```

Design notes: panels are drawn with the 2D canvas so Chinese and every other script render crisply;
the insight engine returns structured data and `i18n.ts` turns it into sentences; every placement
and gesture rule lives in a pure function with a unit test.

### Text input on Quest

WebXR has no text field of its own. NetNote focuses a hidden text field, which makes the Quest
browser show its system keyboard over the immersive scene (the session becomes `visible-blurred`
meanwhile). The keyboard does not report individual keys, so each keyboard session starts on an empty
field and NetNote appends what comes back to the text being written. Voice dictation from the same
keyboard and Bluetooth keyboards work through the same path.

---

## 中文快速上手

NetNote 是一款 VR 原生笔记应用：把 Markdown / Obsidian 笔记摊在身边，用手把它们连起来，
把看到的写下来。

- **这是纯 WebXR 网页应用**：用户在 Quest 浏览器里打开一个公开的 HTTPS 地址即可使用，无需安装。
- **开发**：`npm install` 然后 `npm run dev`（需要 Node.js 20.19+），浏览器会打开桌面预览（内置 Quest 3 模拟器）。
- **在本机开发时用 Quest 试**：电脑和 Quest 连同一个 Wi-Fi，用 Quest 浏览器打开终端里显示的
  `https://电脑IP:8081/`，选择继续访问，点「进入 VR」或「进入混合现实」。
- **在头显里**：捏星星阅读；在空白处捏住移动整个房间，双手拉开缩放；捏住一颗星拖到另一颗上连线，
  并用 Quest 键盘或语音写下原因；左手边是思考墙，并排放的卡片成为一组，会告诉你共同话题、缺的那篇和一个问题；
  「洞察」列出隐藏联系、值得追问、还没写的笔记和漂流的笔记；「手中地图」抓住光环可以随意旋转，大星图跟着转，指一下某颗星就把它转到面前；卡片上「编辑」可按段落修改、插入、删除；
  混合现实下星图会放到你的真实桌面上，思考墙贴在左侧真实的墙前。
- **数据**：都存在浏览器里（IndexedDB），可在入口页导入 zip/文件夹、导出 zip。
- **探索**：卡片上「找路径」再捏另一颗星，显示最短链接路径；「更多」里有漫游、时光机、声音、动效、糯糯（陪伴小精灵，只在左下余光处，不挡视线）。
- **在线体验**：用 Quest 浏览器打开 https://adminzachary.github.io/NetNote/ 即可。
- **发布**：`npm run build` 生成静态网站 `dist/`，放到任意 HTTPS 静态托管即可。
