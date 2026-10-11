// 씨드핵 상세페이지 채우기 — 피그마 플러그인 본체 (figma.* API 만 사용, 네트워크 없음)
// 앱이 만든 out/figma-bundle.json(manifest + 이미지 base64)을 UI 에서 받아
//  1) 현재 페이지에 이름이 "#hero.image" 식인 레이어가 있으면 그 자리에 이미지 fill · 글자 교체
//  2) 하나도 없으면 780px 폭 프레임(세로 auto-layout, 섹션별 프레임 · 텍스트 · 이미지 사각형)을 새로 만든다
"use strict";
figma.showUI(__html__, { width: 440, height: 560, themeColors: true });

var WIDTH = 780, PAD = 44, INNER = WIDTH - PAD * 2;
var FONT_R = { family: "Inter", style: "Regular" }, FONT_B = { family: "Inter", style: "Bold" };

figma.ui.onmessage = function (msg) {
  if (!msg || msg.type !== "apply") return;
  apply(msg.manifest || {}, msg.images || {}).then(function (r) {
    figma.ui.postMessage({ type: "done", result: r });
    figma.notify("씨드핵: 이미지 " + r.images + "장 · 글 " + r.texts + "개" + (r.created ? " (새 프레임 생성)" : " (템플릿 레이어에 채움)"));
  }).catch(function (e) {
    figma.ui.postMessage({ type: "error", message: String(e && e.message || e) });
    figma.notify("씨드핵 오류: " + (e && e.message || e), { error: true });
  });
};

// 섹션별 레이어 값을 한 줄 목록으로: [{ name: "#hero.headline", value: "…", section: "hero", n: 1 }]
function flatten(manifest) {
  var out = [];
  (manifest.sections || []).forEach(function (sec) {
    Object.keys(sec.layers || {}).forEach(function (name) { out.push({ name: name, value: sec.layers[name], section: sec.type, n: sec.n || 1 }); });
  });
  return out;
}
var isImageLayer = function (name, value, images) { return /\.image$/.test(name) || Object.prototype.hasOwnProperty.call(images, value); };

async function apply(manifest, images) {
  var layers = flatten(manifest);
  if (!layers.length) throw new Error("manifest.sections 가 비어 있습니다");
  // 이미지 바이트 → figma 이미지(한 번만 만들어 재사용)
  var hashes = {};
  function imageHash(path) {
    if (hashes[path]) return hashes[path];
    var bytes = images[path];
    if (!bytes || !bytes.length) return null;
    try { hashes[path] = figma.createImage(bytes).hash; } catch (e) { hashes[path] = null; }
    return hashes[path];
  }
  // 1) 템플릿 레이어 찾기(현재 페이지 전체, 이름 정확히 일치)
  var page = figma.currentPage;
  if (typeof page.loadAsync === "function") await page.loadAsync();
  var byName = {};
  page.findAll(function (n) { return n.name && n.name.charAt(0) === "#"; }).forEach(function (n) { (byName[n.name] = byName[n.name] || []).push(n); });
  var counts = { images: 0, texts: 0, missing: [], created: false };
  var found = layers.filter(function (l) { return byName[l.name]; });
  if (found.length) {
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i], nodes = byName[l.name];
      if (!nodes) { counts.missing.push(l.name); continue; }
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        if (isImageLayer(l.name, l.value, images)) {
          var hash = imageHash(l.value);
          if (hash && "fills" in node) { node.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }]; counts.images++; }
          else counts.missing.push(l.name + " (이미지 없음)");
        } else if (node.type === "TEXT") {
          await setText(node, String(l.value == null ? "" : l.value)); counts.texts++;
        }
      }
    }
    return counts;
  }
  // 2) 템플릿이 없으면 새로 만든다 — 누구나 결과를 받을 수 있게
  await figma.loadFontAsync(FONT_R); await figma.loadFontAsync(FONT_B);
  var dark = manifest.template === "dark";
  var root = figma.createFrame();
  root.name = "씨드핵 상세페이지 (" + (manifest.template || "clean") + ")";
  root.layoutMode = "VERTICAL"; root.primaryAxisSizingMode = "AUTO"; root.counterAxisSizingMode = "FIXED";
  root.resize(WIDTH, 100); root.itemSpacing = 0; root.fills = [solid(dark ? "#0f1114" : "#ffffff")];
  // 다른 프레임과 겹치지 않게 현재 뷰 가운데에
  root.x = Math.round(figma.viewport.center.x - WIDTH / 2); root.y = Math.round(figma.viewport.center.y);
  var sections = manifest.sections || [];
  for (var s = 0; s < sections.length; s++) {
    var sec = sections[s];
    var f = figma.createFrame();
    f.name = "#" + sec.type + (sec.n > 1 ? "." + sec.n : "");
    f.layoutMode = "VERTICAL"; f.primaryAxisSizingMode = "AUTO"; f.counterAxisSizingMode = "FIXED";
    f.paddingTop = f.paddingBottom = 56; f.paddingLeft = f.paddingRight = PAD; f.itemSpacing = 18;
    f.fills = [solid(dark ? (s % 2 ? "#131619" : "#0f1114") : (s % 2 ? "#f9fafb" : "#ffffff"))];
    root.appendChild(f); f.layoutAlign = "STRETCH"; f.resize(WIDTH, 100);
    var names = Object.keys(sec.layers || {});
    for (var k = 0; k < names.length; k++) {
      var name = names[k], value = sec.layers[name];
      if (isImageLayer(name, value, images)) {
        var hash2 = imageHash(value), meta = images[value + "__meta"] || {};
        var rect = figma.createRectangle(); rect.name = name;
        var w = INNER, h = meta.w && meta.h ? Math.round(INNER * meta.h / meta.w) : INNER;
        if (h > 1100) h = 1100;
        rect.resize(w, h); rect.cornerRadius = 16;
        rect.fills = hash2 ? [{ type: "IMAGE", scaleMode: "FIT", imageHash: hash2 }] : [solid("#e4e7ec")];
        f.appendChild(rect); rect.layoutAlign = "STRETCH"; counts.images += hash2 ? 1 : 0;
        if (!hash2) counts.missing.push(name + " (이미지 없음)");
      } else {
        var t = figma.createText(); t.name = name;
        var big = /\.headline$/.test(name), mid = /\.title$|\.q$|#(pain|usp)\.title$/.test(name);
        t.fontName = big || mid ? FONT_B : FONT_R;
        t.fontSize = big ? 46 : mid ? 30 : 24; t.lineHeight = { unit: "PERCENT", value: 140 };
        t.fills = [solid(dark ? "#f3efe6" : "#1d2433")];
        t.characters = String(value == null ? "" : value);
        f.appendChild(t); t.layoutAlign = "STRETCH"; t.textAutoResize = "HEIGHT"; t.resize(INNER, t.height);
        counts.texts++;
      }
    }
  }
  figma.currentPage.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);
  counts.created = true;
  return counts;
}

// 글자 교체: 쓰이는 글꼴을 전부 불러온 뒤 characters 를 바꾼다(혼합 글꼴이면 각각)
async function setText(node, value) {
  var fonts = node.fontName === figma.mixed ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName];
  for (var i = 0; i < fonts.length; i++) await figma.loadFontAsync(fonts[i]);
  if (node.fontName === figma.mixed) node.fontName = fonts[0];
  node.characters = value;
}
function solid(hex) {
  var n = parseInt(hex.slice(1), 16);
  return { type: "SOLID", color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 } };
}
