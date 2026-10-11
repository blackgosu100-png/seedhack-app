// macOS Vision 누끼 도구 — 이미지의 전경(제품)만 남긴 알파 PNG 를 만든다. (VNGenerateForegroundInstanceMaskRequest, macOS 14+)
// 빌드: swiftc -O tools/cutout-mac/cutout.swift -o <userData>/detail/bin/cutout-mac   (src/main/detail/cutout.js 가 첫 실행 때 자동으로 한다)
// 사용: cutout-mac <출력 폴더> <이미지1> <이미지2> ...   →  <출력 폴더>/<파일이름>.png
// 출력(stdout JSON 한 줄): {"images":[{"file":"…","out":"…","w":790,"h":600,"bbox":{"x":..,"y":..,"w":..,"h":..},"coverage":0.42,"ok":true}]}
//   - bbox: 전경(마스크 > 0.5) 픽셀의 경계(좌상단 원점), coverage: 전경 픽셀 비율. 전경 인스턴스가 여러 개면 전부 합친다.
//   - 전경을 못 찾거나 오류면 ok:false + error (전체는 실패하지 않는다).
import Foundation
import Vision
import CoreImage
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

func jsonStr(_ s: String) -> String {
  var out = "\""
  for u in s.unicodeScalars {
    switch u {
    case "\"": out += "\\\""
    case "\\": out += "\\\\"
    case "\n": out += "\\n"
    case "\r": out += "\\r"
    case "\t": out += "\\t"
    default: if u.value < 0x20 { out += String(format: "\\u%04x", u.value) } else { out.unicodeScalars.append(u) }
    }
  }
  return out + "\""
}
func loadImage(_ path: String) -> CGImage? {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCache: false] as CFDictionary)
}
func savePNG(_ img: CGImage, _ path: String) -> Bool {
  guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil) else { return false }
  CGImageDestinationAddImage(dest, img, nil)
  return CGImageDestinationFinalize(dest)
}

struct Result { var out: String = ""; var w = 0; var h = 0; var bx = 0; var by = 0; var bw = 0; var bh = 0; var coverage = 0.0; var ok = false; var error: String? = nil }

let ciContext = CIContext(options: [.cacheIntermediates: false])

func cutout(_ img: CGImage, outPath: String) -> Result {
  var r = Result(); r.w = img.width; r.h = img.height
  guard #available(macOS 14.0, *) else { r.error = "macOS 14 이상이 필요합니다"; return r }
  let req = VNGenerateForegroundInstanceMaskRequest()
  let handler = VNImageRequestHandler(cgImage: img, options: [:])
  do { try handler.perform([req]) } catch { r.error = "Vision 실패: \(error.localizedDescription)"; return r }
  guard let obs = req.results?.first, !obs.allInstances.isEmpty else { r.error = "전경을 찾지 못함"; return r }
  // 마스크(원본 크기, 1채널 float) → bbox·coverage
  let maskBuf: CVPixelBuffer
  do { maskBuf = try obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: handler) } catch { r.error = "마스크 생성 실패: \(error.localizedDescription)"; return r }
  CVPixelBufferLockBaseAddress(maskBuf, .readOnly)
  let mw = CVPixelBufferGetWidth(maskBuf), mh = CVPixelBufferGetHeight(maskBuf), stride = CVPixelBufferGetBytesPerRow(maskBuf)
  var minX = mw, minY = mh, maxX = -1, maxY = -1, count = 0
  if let base = CVPixelBufferGetBaseAddress(maskBuf) {
    let fmt = CVPixelBufferGetPixelFormatType(maskBuf)
    for y in 0..<mh {
      let row = base.advanced(by: y * stride)
      for x in 0..<mw {
        var v: Float = 0
        if fmt == kCVPixelFormatType_OneComponent32Float { v = row.advanced(by: x * 4).assumingMemoryBound(to: Float.self).pointee }
        else { v = Float(row.advanced(by: x).assumingMemoryBound(to: UInt8.self).pointee) / 255.0 }
        if v > 0.5 { count += 1; if x < minX { minX = x }; if x > maxX { maxX = x }; if y < minY { minY = y }; if y > maxY { maxY = y } }
      }
    }
  }
  CVPixelBufferUnlockBaseAddress(maskBuf, .readOnly)
  if maxX < 0 { r.error = "전경 픽셀 없음"; return r }
  // 원본 좌표계로(마스크 크기가 다르면 비례)
  let sx = Double(img.width) / Double(mw), sy = Double(img.height) / Double(mh)
  r.bx = Int(Double(minX) * sx); r.by = Int(Double(minY) * sy)
  r.bw = Int(Double(maxX - minX + 1) * sx); r.bh = Int(Double(maxY - minY + 1) * sy)
  r.coverage = Double(count) / Double(mw * mh)
  // 전경만 남긴 이미지(알파) 저장
  let maskedBuf: CVPixelBuffer
  do { maskedBuf = try obs.generateMaskedImage(ofInstances: obs.allInstances, from: handler, croppedToInstancesExtent: false) } catch { r.error = "누끼 이미지 생성 실패: \(error.localizedDescription)"; return r }
  let ci = CIImage(cvPixelBuffer: maskedBuf)
  guard let cg = ciContext.createCGImage(ci, from: ci.extent, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)) else { r.error = "CGImage 변환 실패"; return r }
  guard savePNG(cg, outPath) else { r.error = "PNG 저장 실패"; return r }
  r.out = outPath; r.ok = true
  return r
}

let args = Array(CommandLine.arguments.dropFirst())
if args.count < 2 {
  FileHandle.standardError.write("사용법: cutout-mac <출력 폴더> <이미지 파일> ...\n".data(using: .utf8)!)
  exit(2)
}
let outDir = args[0]
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
var parts: [String] = []
for f in args.dropFirst() {
  let name = (f as NSString).lastPathComponent
  let base = (name as NSString).deletingPathExtension
  let outPath = (outDir as NSString).appendingPathComponent(base + ".png")
  var r = Result()
  if let img = loadImage(f) { r = cutout(img, outPath: outPath) } else { r.error = "이미지를 읽지 못함" }
  var s = "{\"file\":\(jsonStr(f)),\"out\":\(jsonStr(r.out)),\"w\":\(r.w),\"h\":\(r.h),\"bbox\":{\"x\":\(r.bx),\"y\":\(r.by),\"w\":\(r.bw),\"h\":\(r.bh)},\"coverage\":\(String(format: "%.4f", r.coverage)),\"ok\":\(r.ok)"
  if let e = r.error { s += ",\"error\":\(jsonStr(e))" }
  s += "}"
  parts.append(s)
}
print("{\"images\":[\(parts.joined(separator: ","))]}")
