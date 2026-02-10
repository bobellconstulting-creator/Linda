import { google } from "googleapis";

function getAuth() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY");
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/documents.readonly",
    ],
  });
}

export async function appendToSheet(spreadsheetId: string, range: string, values: string[][]) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: {
      values,
    },
  });
}

export async function readGoogleDoc(documentId: string) {
  const auth = getAuth();
  const docs = google.docs({ version: "v1", auth });
  const response = await docs.documents.get({ documentId });
  const content = response.data.body?.content ?? [];
  return content
    .map((item) => item.paragraph?.elements?.map((el) => el.textRun?.content ?? "").join("") ?? "")
    .join("")
    .trim();
}
