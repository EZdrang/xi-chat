/* 把残留的 maid 配色机械替换成蓝色大肥鱼 */
const fs = require('fs');
const p = 'app/assets/style.css';
let s = fs.readFileSync(p, 'utf8');

const MAP = [
  ['rgba(15, 30, 72,', 'rgba(8, 32, 58,'],
  ['rgba(9, 19, 51, .38)', 'rgba(8, 32, 58, .32)'],
  ['rgba(9, 19, 51, .55)', 'rgba(4, 16, 31, .55)'],
  ['rgba(16, 32, 77, .94)', 'rgba(8, 32, 58, .95)'],
  ['rgba(71, 91, 145,', 'rgba(36, 119, 196,'],
  ['rgba(82, 106, 168,', 'rgba(36, 119, 196,'],
  ['rgba(142, 165, 218,', 'rgba(142, 200, 240,'],
  ['rgba(197, 164, 104,', 'rgba(36, 119, 196,'],
  ['rgba(181, 69, 92,', 'rgba(196, 62, 62,'],
  ['rgba(30, 50, 105, .5)', 'rgba(36, 119, 196, .45)'],
  ['rgba(23, 35, 71, .22)', 'rgba(8, 32, 58, .18)'],
  ['#e6d3a8', '#57a9e6'],
  ['#3a2c0c', '#ffffff'],
  ['#2b4479', '#2e8bdd'],
  ['#1c326b', '#1e6bb8'],
  ['#cf8496', '#e08484'],
  ['#b5455c', '#c43e3e'],
  ['#8d3247', '#a33a3a'],
  ['#526aa8', '#2477c4'],
  ['#405a99', '#1e6bb8'],
  ['#8ea5da', '#8ec8f0'],
  ['#172347', '#08203a'],
  ['#243866', '#0e3055'],
  ['#4d5d7f', '#254c74'],
  ['#6b7ba1', '#3f6b93'],
  ['#eef2fb', '#eef8ff'],
  ['#f2f6fd', '#eef8ff'],
  ['#f4f7fd', '#f4fbff'],
  ['#f8faff', '#f4fbff'],
  ['#fdfeff', '#fbfdff'],
  ['#e0e7f6', '#d8eeff'],
  ['#815c18', '#1e6bb8'],
];

for (const [a, b] of MAP) s = s.split(a).join(b);

// 背景光晕换成海蓝
s = s.replace(
  /body::before \{[\s\S]*?\n\}/,
  `body::before {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(820px 500px at 86% -8%, rgba(96, 172, 232, .40), transparent 62%),
    radial-gradient(700px 460px at -12% 4%, rgba(170, 214, 248, .55), transparent 60%),
    radial-gradient(900px 620px at 50% 110%, rgba(216, 238, 255, .92), transparent 72%),
    linear-gradient(180deg, #fbfdff 0%, #f4fbff 46%, #e8f4ff 100%);
}`
);

fs.writeFileSync(p, s, 'utf8');

const leftover = ['#c5a468', '#526aa8', '#172347', '#eef2fb', '#e6d3a8', '#3a2c0c']
  .filter((h) => s.includes(h));
console.log('替换完成；残留:', leftover.length ? leftover : '无');
