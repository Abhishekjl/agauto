import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  AlignmentType,
  BorderStyle,
  convertMillimetersToTwip,
} from "docx";

export interface DocxResult {
  dataBase64: string;
  filename: string;
}

/**
 * Generate a clean 2-page Word document from a tailored profile string.
 * The profile must follow the structured format output by tailor.ts.
 */
export async function generateTailoredDocx(
  tailoredProfile: string,
  jobTitle: string,
  company: string
): Promise<DocxResult> {
  const lines = tailoredProfile.split("\n").map((l) => l.trimEnd());
  const children: Paragraph[] = [];

  let name = "";
  let contact = "";

  // Parse header fields first
  for (const line of lines) {
    if (line.startsWith("NAME:")) { name = line.replace("NAME:", "").trim(); }
    if (line.startsWith("CONTACT:")) { contact = line.replace("CONTACT:", "").trim(); }
  }

  // Name header
  if (name) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [new TextRun({ text: name, bold: true, size: 36, font: "Calibri" })],
      })
    );
  }

  // Contact line
  if (contact) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: contact, size: 20, color: "555555", font: "Calibri" })],
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: "C0C0C0", space: 4 },
        },
      })
    );
  }

  // Parse remaining sections
  const SECTION_HEADERS = new Set([
    "SUMMARY", "EXPERIENCE", "SKILLS", "EDUCATION",
    "PROJECTS", "CERTIFICATIONS", "ACHIEVEMENTS", "PUBLICATIONS",
  ]);

  let inHeader = true;
  let lastWasJobLine = false;
  let inProjectsSection = false;

  for (const line of lines) {
    // Skip the NAME/CONTACT lines already handled
    if (line.startsWith("NAME:") || line.startsWith("CONTACT:")) { inHeader = false; continue; }
    if (inHeader && !line.trim()) continue;
    inHeader = false;

    if (!line.trim()) {
      children.push(new Paragraph({ spacing: { after: 40 } }));
      lastWasJobLine = false;
      continue;
    }

    const upper = line.trim().toUpperCase();

    // Section heading
    if (SECTION_HEADERS.has(upper)) {
      inProjectsSection = upper === "PROJECTS";
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 60 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 4, color: "6366F1", space: 2 },
          },
          children: [
            new TextRun({
              text: line.trim(),
              bold: true,
              size: 24,
              color: "3730A3",
              font: "Calibri",
            }),
          ],
        })
      );
      lastWasJobLine = false;
      continue;
    }

    // Bullet point
    if (line.trimStart().startsWith("•") || line.trimStart().startsWith("-")) {
      const text = line.trimStart().replace(/^[•\-]\s*/, "");
      children.push(
        new Paragraph({
          indent: { left: convertMillimetersToTwip(6) },
          spacing: { after: 40 },
          bullet: { level: 0 },
          children: [new TextRun({ text, size: 20, font: "Calibri" })],
        })
      );
      lastWasJobLine = false;
      continue;
    }

    // Project line — "Project Name | Tech Stack" — or job line "Title | Company | Date"
    if (!lastWasJobLine && line.includes(" | ")) {
      const parts = line.split(" | ");
      if (inProjectsSection) {
        // Project: bold name, italic tech stack
        children.push(
          new Paragraph({
            spacing: { before: 120, after: 40 },
            children: [
              new TextRun({ text: parts[0]?.trim() ?? "", bold: true, size: 22, font: "Calibri" }),
              new TextRun({ text: parts.length > 1 ? "  |  " + parts.slice(1).join("  |  ") : "", size: 20, italics: true, color: "555555", font: "Calibri" }),
            ],
          })
        );
      } else {
        // Job: bold title, normal company/date
        children.push(
          new Paragraph({
            spacing: { before: 100, after: 40 },
            children: [
              new TextRun({ text: parts[0]?.trim() ?? "", bold: true, size: 22, font: "Calibri" }),
              new TextRun({ text: parts.length > 1 ? "  |  " + parts.slice(1).join("  |  ") : "", size: 20, color: "555555", font: "Calibri" }),
            ],
          })
        );
      }
      lastWasJobLine = true;
      continue;
    }

    // Regular paragraph
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: line.trim(), size: 20, font: "Calibri" })],
      })
    );
    lastWasJobLine = false;
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(20),
              right: convertMillimetersToTwip(20),
              bottom: convertMillimetersToTwip(20),
              left: convertMillimetersToTwip(20),
            },
          },
        },
        children,
      },
    ],
  });

  const base64 = await Packer.toBase64String(doc);

  function slug(s: string, max = 30) {
    return s.trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, max) || "Unknown";
  }
  const filename = `${slug(name)}_${slug(jobTitle)}_${slug(company)}.docx`;

  return { dataBase64: base64, filename };
}
