// macOS Vision OCR 도구 — 이미지 파일 여러 개를 받아 글자 상자를 JSON 한 줄로 stdout에 출력한다.
// 빌드: swiftc -O tools/ocr-mac/ocr.swift -o <userData>/detail/bin/ocr-mac   (src/main/detail/ocr.js 가 첫 실행 때 자동으로 한다)
// 사용: ocr-mac <이미지1> <이미지2> ...
// 출력: {"images":[{"file":"…","w":790,"h":1200,"boxes":[{"x":40,"y":120,"w":300,"h":48,"text":"加厚材质","conf":0.93}]}]}
//   - 좌표는 픽셀, 좌상단 원점. 상자는 줄(line) 단위(Vision 의 observation 하나 = 한 줄).
//   - 읽지 못한 파일은 boxes 가 빈 배열이고 "error" 에 사유가 들어간다(전체는 실패하지 않는다).
import Foundation
import Vision
import ImageIO
import CoreGraphics

struct Box { let x: Int; let y: Int; let w: Int; let h: Int; let text: String; let conf: Double; let quad: [Int]; let angle: Double }

// JSON 문자열 이스케이프(따옴표·역슬래시·제어문자)
func jsonStr(_ s: String) -> String {
  var out = "\""
  for u in s.unicodeScalars {
    switch u {
    case "\"": out += "\\\""
    case "\\": out += "\\\\"
    case "\n": out += "\\n"
    case "\r": out += "\\r"
    case "\t": out += "\\t"
    default:
      if u.value < 0x20 { out += String(format: "\\u%04x", u.value) } else { out.unicodeScalars.append(u) }
    }
  }
  return out + "\""
}

// 이미지 파일 → CGImage (jpg/png/webp/heic 등 ImageIO 가 아는 형식 전부)
func loadImage(_ path: String) -> CGImage? {
  let url = URL(fileURLWithPath: path)
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCache: false] as CFDictionary)
}

func recognize(_ img: CGImage) -> ([Box], String?) {
  let W = Double(img.width), H = Double(img.height)
  var boxes: [Box] = []
  var err: String? = nil
  let req = VNRecognizeTextRequest { request, error in
    if let e = error { err = e.localizedDescription; return }
    guard let obs = request.results as? [VNRecognizedTextObservation] else { return }
    for o in obs {
      guard let top = o.topCandidates(1).first else { continue }
      let text = top.string.trimmingCharacters(in: .whitespacesAndNewlines)
      if text.isEmpty { continue }
      // Vision 의 boundingBox 는 정규화 좌표(좌하단 원점) → 픽셀·좌상단 원점으로 변환
      let bb = o.boundingBox
      let x = bb.minX * W, w = bb.width * W
      let yTop = (1.0 - bb.maxY) * H, h = bb.height * H
      // 기울어진 글(사선 위 글자)용: 네 꼭짓점(좌상·우상·우하·좌하, 픽셀·좌상단 원점)과 기울기(도, 시계 방향 +)
      let P = { (p: CGPoint) -> (Double, Double) in (Double(p.x) * W, (1.0 - Double(p.y)) * H) }
      let tl = P(o.topLeft), tr = P(o.topRight), br = P(o.bottomRight), bl = P(o.bottomLeft)
      let quad = [tl.0, tl.1, tr.0, tr.1, br.0, br.1, bl.0, bl.1].map { Int($0.rounded()) }
      let angle = atan2(tr.1 - tl.1, tr.0 - tl.0) * 180.0 / Double.pi
      boxes.append(Box(x: Int(x.rounded(.down)), y: Int(yTop.rounded(.down)), w: Int(w.rounded(.up)), h: Int(h.rounded(.up)), text: text, conf: Double(top.confidence), quad: quad, angle: angle))
    }
  }
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = true
  // 기본은 중국어(1688 상세). SEEDHACK_OCR_LANGS="ko-KR,en-US" 처럼 주면 그 언어(레퍼런스 한국어 상세 분석용)
  if let langs = ProcessInfo.processInfo.environment["SEEDHACK_OCR_LANGS"], !langs.isEmpty { req.recognitionLanguages = langs.split(separator: ",").map { String($0) } }
  else { req.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"] }
  if #available(macOS 13.0, *) { req.revision = VNRecognizeTextRequestRevision3 }
  let handler = VNImageRequestHandler(cgImage: img, options: [:])
  do { try handler.perform([req]) } catch { err = error.localizedDescription }
  // 위→아래, 왼→오른 순서로 정렬(줄 순서가 읽는 순서와 같게)
  boxes.sort { a, b in abs(a.y - b.y) > 8 ? a.y < b.y : a.x < b.x }
  return (boxes, err)
}

let files = Array(CommandLine.arguments.dropFirst())
if files.isEmpty {
  FileHandle.standardError.write("사용법: ocr-mac <이미지 파일> ...\n".data(using: .utf8)!)
  exit(2)
}

var parts: [String] = []
for f in files {
  guard let img = loadImage(f) else {
    parts.append("{\"file\":\(jsonStr(f)),\"w\":0,\"h\":0,\"boxes\":[],\"error\":\"이미지를 읽지 못함\"}")
    continue
  }
  let (boxes, err) = recognize(img)
  let bs = boxes.map { b in
    "{\"x\":\(b.x),\"y\":\(b.y),\"w\":\(b.w),\"h\":\(b.h),\"text\":\(jsonStr(b.text)),\"conf\":\(String(format: "%.3f", b.conf)),\"angle\":\(String(format: "%.1f", b.angle)),\"quad\":[\(b.quad.map { String($0) }.joined(separator: ","))]}"
  }.joined(separator: ",")
  var s = "{\"file\":\(jsonStr(f)),\"w\":\(img.width),\"h\":\(img.height),\"boxes\":[\(bs)]"
  if let e = err { s += ",\"error\":\(jsonStr(e))" }
  s += "}"
  parts.append(s)
}
print("{\"images\":[\(parts.joined(separator: ","))]}")
