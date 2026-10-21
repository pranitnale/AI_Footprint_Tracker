"""Render the research Markdown as a linked, paginated PDF. No network access."""

from pathlib import Path
import html
import re
import textwrap

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer,
    Table, TableStyle, Preformatted,
)
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "research" / "report-source.md"
OUTPUT = ROOT / "output" / "pdf" / "AI-Resource-Counter-Research.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

pdfmetrics.registerFont(TTFont("Report", "C:/Windows/Fonts/arial.ttf"))
pdfmetrics.registerFont(TTFont("ReportBold", "C:/Windows/Fonts/arialbd.ttf"))
pdfmetrics.registerFont(TTFont("ReportMono", "C:/Windows/Fonts/consola.ttf"))
pdfmetrics.registerFontFamily("Report", normal="Report", bold="ReportBold", italic="Report", boldItalic="ReportBold")

INK = colors.HexColor("#20352F")
ACCENT = colors.HexColor("#216953")
MUTED = colors.HexColor("#5A6862")
RULE = colors.HexColor("#CCD8D0")
PALE = colors.HexColor("#F1F5F2")
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="BodyReport", fontName="Report", fontSize=9.5, leading=13.5,
                          textColor=INK, spaceAfter=7.5, allowWidows=0, allowOrphans=0))
styles.add(ParagraphStyle(name="ReportTitle", fontName="ReportBold", fontSize=29, leading=33,
                          textColor=INK, spaceAfter=14, keepWithNext=True))
styles.add(ParagraphStyle(name="Section", fontName="ReportBold", fontSize=16, leading=20,
                          textColor=ACCENT, spaceBefore=16, spaceAfter=9, keepWithNext=True))
styles.add(ParagraphStyle(name="Subsection", fontName="ReportBold", fontSize=11.6, leading=15,
                          textColor=INK, spaceBefore=10, spaceAfter=6, keepWithNext=True))
styles.add(ParagraphStyle(name="ListReport", parent=styles["BodyReport"], leftIndent=12,
                          firstLineIndent=-9, spaceAfter=5))
styles.add(ParagraphStyle(name="Cell", parent=styles["BodyReport"], fontSize=8.1, leading=11.1,
                          spaceAfter=0))
styles.add(ParagraphStyle(name="CellHead", parent=styles["Cell"], fontName="ReportBold", textColor=ACCENT))
styles.add(ParagraphStyle(name="CodeReport", fontName="ReportMono", fontSize=7.7, leading=11,
                          textColor=INK, backColor=PALE, borderPadding=8, spaceBefore=5, spaceAfter=12))


def inline(value):
    value = html.escape(value, quote=False)
    value = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)",
                   lambda m: '<link href="' + m.group(2).replace('"', '&quot;') + '" color="#216953"><u>' + m.group(1) + '</u></link>', value)
    value = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"`([^`]+)`", r'<font name="ReportMono">\1</font>', value)
    return value


class ResearchDoc(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(filename, pagesize=A4, leftMargin=46, rightMargin=46,
                         topMargin=49, bottomMargin=45,
                         title="AI Resource Counter: Feasibility and Research",
                         author="Research prepared for the Resource Calculator project")
        self.addPageTemplates(PageTemplate(id="report", frames=[
            Frame(self.leftMargin, self.bottomMargin, self.width, self.height,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        ], onPage=self.decorate))
        self.heading_count = 0

    def decorate(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(46, A4[1] - 33, A4[0] - 46, A4[1] - 33)
        canvas.setFont("Report", 7.6)
        canvas.setFillColor(MUTED)
        canvas.drawString(46, A4[1] - 24, "RESOURCE CALCULATOR  /  RESEARCH & FEASIBILITY")
        canvas.drawRightString(A4[0] - 46, A4[1] - 24, "7 SEPTEMBER 2026")
        canvas.line(46, 32, A4[0] - 46, 32)
        canvas.drawString(46, 21, "Operational conversation estimates | Public-source evidence")
        canvas.drawRightString(A4[0] - 46, 21, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == "Section":
            self.heading_count += 1
            key = f"section-{self.heading_count}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(flowable.getPlainText(), key, level=0, closed=False)


doc = ResearchDoc(str(OUTPUT))
story = []
lines = SOURCE.read_text(encoding="utf-8").splitlines()
i = 0
while i < len(lines):
    line = lines[i].strip()
    if not line:
        i += 1
        continue
    if line.startswith("```"):
        block = []
        i += 1
        while i < len(lines) and not lines[i].strip().startswith("```"):
            raw = lines[i]
            block.extend(textwrap.wrap(raw, width=100, replace_whitespace=False,
                                       drop_whitespace=False, subsequent_indent="  ") or [""])
            i += 1
        story.append(Preformatted("\n".join(block), styles["CodeReport"]))
        i += 1
        continue
    if line.startswith("|"):
        rows = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            cells = [part.strip() for part in lines[i].strip().strip("|").split("|")]
            if not all(re.fullmatch(r":?-+:?", c) for c in cells):
                rows.append(cells)
            i += 1
        n = len(rows[0])
        ratios = [0.27, 0.45, 0.28] if n == 3 else [0.13, 0.20, 0.43, 0.24]
        widths = [doc.width * v for v in ratios] if n in (3, 4) else [doc.width / n] * n
        values = [[Paragraph(inline(c), styles["CellHead" if idx == 0 else "Cell"])
                   for c in row] for idx, row in enumerate(rows)]
        table = Table(values, colWidths=widths, repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E3EEE7")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LINEBELOW", (0, 0), (-1, 0), 0.7, RULE),
            ("LINEBELOW", (0, -1), (-1, -1), 0.5, RULE),
        ]))
        story.extend([table, Spacer(1, 10)])
        continue
    if line.startswith("### "):
        story.append(Paragraph(inline(line[4:]), styles["Subsection"]))
    elif line.startswith("## "):
        story.append(Paragraph(inline(line[3:]), styles["Section"]))
    elif line.startswith("# "):
        story.append(Paragraph(inline(line[2:]), styles["ReportTitle"]))
    elif line.startswith("- "):
        story.append(Paragraph("&#8226; " + inline(line[2:]), styles["ListReport"]))
    elif re.match(r"^\d+\. ", line):
        story.append(Paragraph(inline(line), styles["ListReport"]))
    else:
        paragraph = [line]
        while i + 1 < len(lines) and lines[i + 1].strip() and not re.match(r"^(#|\||```|- |\d+\. )", lines[i + 1]):
            i += 1
            paragraph.append(lines[i].strip())
        story.append(Paragraph(inline(" ".join(paragraph)), styles["BodyReport"]))
    i += 1

doc.build(story)
reader = PdfReader(OUTPUT)
all_text = "\n".join(page.extract_text() or "" for page in reader.pages)
links = sum(len(page.get("/Annots", [])) for page in reader.pages)
expected = ["1. Recommendation", "3. Tokenizer choices", "7. Equations", "13. Remaining decisions"]
for phrase in expected:
    assert phrase in all_text, f"Missing section: {phrase}"
assert len(reader.pages) >= 5
assert links >= 35, f"Expected clickable source references, found {links}"
assert "turn0view" not in all_text
print(f"PDF: {OUTPUT}")
print(f"Pages: {len(reader.pages)}; annotations: {links}; words: {len(all_text.split())}")
for number, page in enumerate(reader.pages, 1):
    body = page.extract_text() or ""
    print(f"Page {number}: {len(body.split())} words; last: {body.splitlines()[-1][:95]}")
