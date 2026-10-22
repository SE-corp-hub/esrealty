/* A real .xlsx file (roadmap J7), small enough to ship: Office Open XML sheets in a zip that is
 * stored, not compressed, so no compression library is needed. The "Excel" exports used to be an
 * HTML page renamed .xls, which Excel opens with a warning and LibreOffice or Google Sheets often
 * mangle. UMD: browser window.ESREALTY_XLSX, Node module.exports (the test unzips the result).
 *
 * build(sheets) -> Uint8Array.  sheets: [{ name, headers: [..], rows: [[..], ..] }]
 * Numbers stay numbers; everything else is text (never a formula). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESREALTY_XLSX = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    return Uint8Array.from(Buffer.from(str, "utf8"));
  }

  // Zip with every file stored (method 0). Enough for any spreadsheet program.
  function zip(files) {
    var parts = [], central = [], offset = 0;
    var le16 = function (v) { return [v & 255, (v >>> 8) & 255]; };
    var le32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    files.forEach(function (f) {
      var name = utf8(f.name), data = f.data, crc = crc32(data);
      var head = [].concat([0x50, 0x4b, 0x03, 0x04], le16(20), le16(0x0800), le16(0), le16(0), le16(0x21), le32(crc), le32(data.length), le32(data.length), le16(name.length), le16(0));
      parts.push(Uint8Array.from(head), name, data);
      central.push(Uint8Array.from([].concat([0x50, 0x4b, 0x01, 0x02], le16(20), le16(20), le16(0x0800), le16(0), le16(0), le16(0x21), le32(crc), le32(data.length), le32(data.length), le16(name.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(offset))), name);
      offset += head.length + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var end = Uint8Array.from([].concat([0x50, 0x4b, 0x05, 0x06], le16(0), le16(0), le16(files.length), le16(files.length), le32(cdSize), le32(offset), le16(0)));
    var all = parts.concat(central, [end]), total = all.reduce(function (s, p) { return s + p.length; }, 0);
    var out = new Uint8Array(total), at = 0;
    all.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  function xml(s) {
    return String(s == null ? "" : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function col(i) { var s = ""; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function cell(v, ref, bold) {
    var style = bold ? ' s="1"' : "";
    if (typeof v === "number" && isFinite(v)) return '<c r="' + ref + '"' + style + "><v>" + v + "</v></c>";
    if (typeof v === "boolean") return '<c r="' + ref + '" t="b"' + style + "><v>" + (v ? 1 : 0) + "</v></c>";
    var text = String(v == null ? "" : v);
    if (text === "") return "";
    return '<c r="' + ref + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' + xml(text.slice(0, 32767)) + "</t></is></c>";
  }
  function sheetXml(sh) {
    var rows = [sh.headers || []].concat(sh.rows || []);
    var body = rows.map(function (r, i) {
      return '<row r="' + (i + 1) + '">' + (r || []).map(function (v, j) { return cell(v, col(j) + (i + 1), i === 0); }).join("") + "</row>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + "</sheetData></worksheet>";
  }
  // Sheet names: at most 31 characters, none of : \ / ? * [ ], unique.
  function sheetNames(sheets) {
    var used = {};
    return sheets.map(function (sh, i) {
      var base = String(sh.name || "Sheet" + (i + 1)).replace(/[:\\\/?*\[\]]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Sheet" + (i + 1);
      var n = base, k = 2;
      while (used[n.toLowerCase()]) { var suf = " (" + k++ + ")"; n = base.slice(0, 31 - suf.length) + suf; }
      used[n.toLowerCase()] = 1;
      return n;
    });
  }

  function build(sheets) {
    sheets = (sheets && sheets.length) ? sheets : [{ name: "Sheet1", headers: [], rows: [] }];
    var names = sheetNames(sheets);
    var files = [
      { name: "[Content_Types].xml", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        names.map(function (_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("") + "</Types>" },
      { name: "_rels/.rels", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: "xl/workbook.xml", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        names.map(function (n, i) { return '<sheet name="' + xml(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join("") + "</sheets></workbook>" },
      { name: "xl/_rels/workbook.xml.rels", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        names.map(function (_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join("") +
        '<Relationship Id="rId' + (names.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: "xl/styles.xml", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
    ].concat(sheets.map(function (sh, i) { return { name: "xl/worksheets/sheet" + (i + 1) + ".xml", text: sheetXml(sh) }; }));
    return zip(files.map(function (f) { return { name: f.name, data: utf8(f.text) }; }));
  }

  return { build: build, crc32: crc32, col: col, sheetNames: sheetNames, MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
});
