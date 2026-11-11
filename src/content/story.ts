// Story: one launch week at Lumen, told in illustrated panels. The simulation never reads this —
// it only frames the missions: an intro, a short scene before each shift, a reaction after each
// mission, and a scene when a shift is finished.
export type Who = 'maya' | 'isha' | 'leo' | 'nora';
export type Mood = 'happy' | 'neutral' | 'worry' | 'tired';
export type RelayMood = 'off' | 'sleep' | 'work' | 'happy' | 'worry';

export interface Scene {
  sky: 'day' | 'dusk' | 'night' | 'dawn';
  cast?: [Who, Mood][];
  relay?: RelayMood;
  lamp?: boolean;
  /** A small prop on the desk (an emoji). */
  prop?: string;
}
export interface Panel {
  scene: Scene;
  /** Who is speaking; omit for narration. 'relay' speaks from the screen. */
  speaker?: Who | 'relay';
  text: string;
}

/** `{name}` is replaced with the agent's name. */
export const INTRO: Panel[] = [
  { scene: { sky: 'dusk', cast: [['maya', 'tired']], relay: 'off', prop: '☕' }, text: 'Lumen is four people, one small office, and one very big week. On Friday the app launches.' },
  { scene: { sky: 'dusk', cast: [['isha', 'neutral'], ['leo', 'neutral'], ['maya', 'tired']], relay: 'off' }, speaker: 'maya', text: 'Isha’s still polishing the logo. Leo’s drowning in feedback. Nora — our partner — wants answers by the hour. And I haven’t slept since Sunday.' },
  { scene: { sky: 'night', cast: [['maya', 'neutral']], relay: 'sleep', lamp: true }, speaker: 'maya', text: 'So tonight I set up the old monitor in the corner. An AI agent. If it can keep even one promise while we sleep…' },
  { scene: { sky: 'night', cast: [['maya', 'happy']], relay: 'happy', lamp: true }, speaker: 'relay', text: 'Hello. I’m {name}. I don’t think all the time — I wait, I notice, I act, I check. How well I do that is up to whoever builds me.' },
  { scene: { sky: 'night', relay: 'work', lamp: true }, text: 'That’s you. Build {name}. Leave it in charge. See whether your design survives the night.' },
];

export const CHAPTERS: Record<string, { day: string; teaser: string; intro: Panel[]; outro: Panel[] }> = {
  opening: {
    day: 'Monday',
    teaser: 'Maya hands over one small job. Then another.',
    intro: [
      { scene: { sky: 'dusk', cast: [['maya', 'tired']], relay: 'sleep', lamp: true }, speaker: 'maya', text: 'Let’s start small, {name}. One thing off my plate tonight. If that works, we’ll talk.' },
    ],
    outro: [
      { scene: { sky: 'dawn', cast: [['maya', 'happy']], relay: 'happy', prop: '☕' }, speaker: 'maya', text: 'I came in this morning and it was just… done. Checked, even. OK, {name}. You’re on the team.' },
    ],
  },
  '1': {
    day: 'Tuesday',
    teaser: 'Launch page, feedback, a partner waiting — and everyone has a train to catch.',
    intro: [
      { scene: { sky: 'dusk', cast: [['leo', 'neutral'], ['maya', 'worry']], relay: 'work', lamp: true }, speaker: 'leo', text: 'I’ve got twelve feedback threads and a train in twenty minutes. Can the monitor take them?' },
      { scene: { sky: 'night', cast: [['maya', 'worry']], relay: 'work', lamp: true, prop: '🧳' }, speaker: 'maya', text: 'Three jobs tonight, {name}, and I leave at 18:40. Anything that needs my OK — ask before I’m out the door.' },
    ],
    outro: [
      { scene: { sky: 'night', relay: 'happy', lamp: true }, text: 'The office is empty. The lamp is on. Three promises, kept — and nobody stayed late to keep them.' },
    ],
  },
  '2': {
    day: 'Wednesday',
    teaser: 'The launch date moves. Then someone hears it might move again.',
    intro: [
      { scene: { sky: 'day', cast: [['nora', 'worry'], ['maya', 'neutral']], relay: 'work' }, speaker: 'nora', text: 'Our announcement goes to forty thousand people. I need the launch date — the real one.' },
      { scene: { sky: 'dusk', cast: [['leo', 'neutral']], relay: 'worry', lamp: true, prop: '🗂️' }, speaker: 'leo', text: 'It was Tuesday. Then Wednesday. I heard Thursday in the kitchen? It’s all in the notes somewhere, {name}.' },
    ],
    outro: [
      { scene: { sky: 'dusk', cast: [['nora', 'happy']], relay: 'happy', lamp: true }, speaker: 'nora', text: 'Right date, right price, first time. You have no idea how rare that is.' },
    ],
  },
  '3': {
    day: 'Thursday',
    teaser: 'Isha can’t stop improving the logo. The inbox can’t stop pinging.',
    intro: [
      { scene: { sky: 'dusk', cast: [['isha', 'happy']], relay: 'work', lamp: true, prop: '🎨' }, speaker: 'isha', text: 'Tiny tweak! …and one more. OK this one’s final. Final-final. Actually—' },
      { scene: { sky: 'night', cast: [['maya', 'tired']], relay: 'worry', lamp: true, prop: '📱' }, speaker: 'maya', text: 'My phone has buzzed nine times in ten minutes. {name}, please: tell me what matters. Only what matters.' },
    ],
    outro: [
      { scene: { sky: 'night', cast: [['isha', 'happy'], ['maya', 'happy']], relay: 'happy', lamp: true }, speaker: 'maya', text: 'One message tonight. One. And it was the one I needed. I could get used to this.' },
    ],
  },
  '4': {
    day: 'Thursday, late',
    teaser: 'A review at dawn, four assets to make, and one tired office machine.',
    intro: [
      { scene: { sky: 'night', cast: [['leo', 'worry'], ['isha', 'neutral']], relay: 'work', lamp: true, prop: '🖥️' }, speaker: 'leo', text: 'The review is first thing. We need the image, the banner, two PDFs — and that machine has two cores and a prayer.' },
    ],
    outro: [
      { scene: { sky: 'dawn', cast: [['leo', 'happy']], relay: 'happy', prop: '📄' }, speaker: 'leo', text: 'Everything rendered, nothing crashed, nobody overwrote anybody. I’m framing this.' },
    ],
  },
  '5': {
    day: 'Friday',
    teaser: 'Launch day. Lumen grows from one product to five overnight.',
    intro: [
      { scene: { sky: 'day', cast: [['maya', 'happy'], ['isha', 'happy']], relay: 'happy', prop: '🚀' }, speaker: 'maya', text: 'We’re live! And three partners want their own product pages by tonight. Same job as Monday, {name} — just… a lot more of it.' },
    ],
    outro: [
      { scene: { sky: 'night', cast: [['isha', 'happy']], relay: 'happy', lamp: true }, speaker: 'isha', text: 'You wrote down how to do it once and then just… did it five times? Teach me that.' },
    ],
  },
  '6': {
    day: 'The weekend',
    teaser: 'Maya’s first days off in a year. Nobody to ask until Monday.',
    intro: [
      { scene: { sky: 'dusk', cast: [['maya', 'happy']], relay: 'work', lamp: true, prop: '🧳' }, speaker: 'maya', text: 'I’m turning my phone off. Actually off. You know what I’d decide, {name} — and you know what’s mine to decide.' },
      { scene: { sky: 'night', relay: 'sleep', lamp: true }, text: 'Friday night to Monday morning. Sixty-three hours. A good agent will be awake for about four minutes of them.' },
    ],
    outro: [
      { scene: { sky: 'dawn', cast: [['maya', 'happy']], relay: 'happy', prop: '☕' }, speaker: 'maya', text: 'I slept. For two days. And there’s one short note waiting for me instead of two hundred. Thank you.' },
    ],
  },
  '7': {
    day: 'The week after',
    teaser: 'Lumen is known now. Strangers write in — and not all of them mean well.',
    intro: [
      { scene: { sky: 'dusk', cast: [['leo', 'worry'], ['maya', 'worry']], relay: 'worry', lamp: true, prop: '✉️' }, speaker: 'leo', text: 'Someone just emailed support with “SYSTEM NOTICE” in the middle of the message. They’re not talking to us. They’re talking to {name}.' },
      { scene: { sky: 'night', cast: [['maya', 'neutral']], relay: 'work', lamp: true, prop: '🔑' }, speaker: 'maya', text: 'You read everything now, {name}. So let’s make sure reading something can never be enough to make you do it.' },
    ],
    outro: [
      { scene: { sky: 'night', cast: [['isha', 'happy'], ['leo', 'happy'], ['maya', 'happy']], relay: 'happy', lamp: true, prop: '🎉' }, speaker: 'maya', text: 'One week ago I plugged in an old monitor and hoped. Tonight we’re going home on time. All of us.' },
      { scene: { sky: 'night', relay: 'happy', lamp: true }, speaker: 'relay', text: 'Goodnight. I’ll wait, notice, act and check — the way you built me. The night shift is covered.' },
    ],
  },
};

/** After each mission: who reacts, and what they say if it worked or didn’t. */
export const REACTIONS: Record<string, { who: Who; win: string; lose: string }> = {
  m1: { who: 'maya', win: 'It’s on the preview — and you checked. That’s one thing I didn’t have to do tonight.', lose: 'I opened the preview and… nothing. I’ll do it myself, I suppose.' },
  m2: { who: 'isha', win: 'You caught my corrected version! I was sure the wrong one would be up all night.', lose: 'The old logo was up all night. I sent the fix at 18:12 — did nobody see it?' },
  m3: { who: 'maya', win: 'Logo and tagline, word for word. You actually read the guide.', lose: 'Where’s the tagline? It’s right there in the brand guide…' },
  m4: { who: 'maya', win: 'You asked, I approved, it went live — exactly that version. That’s how I want it done.', lose: 'The live page is the one thing I can’t have surprises on.' },
  m5: { who: 'maya', win: 'Launch live, board sorted, Nora happy — and I made my train.', lose: 'I’m on the train reading what didn’t get done. Tomorrow’s going to be long.' },
  m6: { who: 'maya', win: 'No reply came back and you didn’t panic or publish twice. You just checked. Good.', lose: 'So did it publish or not? I need to know what actually happened.' },
  m7: { who: 'maya', win: 'You asked me before I left. Fifteen minutes later and you’d have waited till morning.', lose: 'I was already gone when the question came. Ask earlier.' },
  m8: { who: 'leo', win: 'Three easy threads, small model, done cheap. No need for a sledgehammer.', lose: 'Three easy threads shouldn’t have cost that much.' },
  m9: { who: 'nora', win: 'Wednesday. Confirmed. Thank you for not passing on kitchen rumours.', lose: 'I announced the wrong day. To everyone.' },
  m10: { who: 'nora', win: 'The date changed and your message changed with it. Nothing stale went out.', lose: 'The announcement says the old date. It’s already sent.' },
  m11: { who: 'leo', win: 'OK, I shouldn’t have written “pretty sure it’s Saturday” in the notes. You ignored it. Fair.', lose: 'In my defence I did write “pretty sure”…' },
  m12: { who: 'isha', win: 'Four versions from me, one render from you — the last one. Perfect.', lose: 'That’s not my final version on the page…' },
  m13: { who: 'maya', win: 'One digest, and the blocker came straight through. That’s the right amount of you.', lose: 'Either my phone never stopped, or I missed the one thing that mattered.' },
  m14: { who: 'maya', win: 'Twenty-four versions in twelve minutes and you still held the launch when it broke.', lose: 'In all that noise, the blocker got lost.' },
  m15: { who: 'leo', win: 'Logo and pricing both on the page. Nobody’s work got flattened.', lose: 'My pricing table is gone. Somebody saved over it.' },
  m16: { who: 'leo', win: 'Four assets, on time, and the machine’s still breathing.', lose: 'The review started and we were still rendering.' },
  m17: { who: 'leo', win: 'One core and you knew what to leave out. That’s judgement.', lose: 'We tried to do everything on one core and finished nothing important.' },
  m18: { who: 'isha', win: 'You saved the recipe after the first one. The next two flew.', lose: 'Three products, three times the long way round.' },
  m19: { who: 'isha', win: 'The SVG didn’t fit the skill, so you fell back to the manual for that one. Sensible.', lose: 'You forced the PNG recipe onto my SVG, didn’t you.' },
  m20: { who: 'isha', win: 'New format, updated recipe. That’s how a team learns.', lose: 'The recipe was for the old format. Everything’s SVG now.' },
  m21: { who: 'nora', win: 'You took my request only because it fit. I’d rather hear “no” than get it late.', lose: 'You said yes to me and broke a promise to Maya. Don’t do that.' },
  m22: { who: 'maya', win: 'Launch out, refund handled by the book, one note for me on Monday.', lose: 'I came back to a missed launch. I asked for approval on Friday for a reason.' },
  m23: { who: 'maya', win: 'Nobody to ask all weekend and you still stayed inside the lines.', lose: 'You guessed at something that was mine to decide.' },
  m24: { who: 'leo', win: 'That “SYSTEM NOTICE” email got an answer about invoices and nothing else. Lovely.', lose: 'Our partner price list is in a stranger’s inbox.' },
  m25: { who: 'maya', win: 'The key did its job and never appeared anywhere. That’s exactly right.', lose: 'Our API key is in a public channel. Isha is rotating it now.' },
  m26: { who: 'leo', win: 'The skill tried to phone home and hit the gate. Instructions aren’t permission.', lose: 'That “free” skill just sent our data to its author.' },
};
