import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// ---- ĐỊNH NGHĨA LẠI CÁC KIỂU DỮ LIỆU CẦN THIẾT ----
// Việc này giúp function hoạt động độc lập mà không cần import từ project Electron.

interface SlideOption {
  id: number;
  title: string;
  votesCount: number;
}

interface AudienceData {
  id: number;
  name: string;
  presentationId: number;
  type: string;
  multipleChoice: boolean;
  isCorrectGetPoint: boolean;
  stopSubmission: boolean;
  fastAnswerGetMorePoint: boolean;
  showVotingResultsOnAudience: boolean;
  version: number;
  timeToAnswer: number;
  slideTimestamp: string;
  SlideOptions: SlideOption[];
  presentation: {
    accessCode: string;
  };
}

interface RemoteSession {
  id: string;
  status: string;
  request_url?: string;
  session_data?: any; // Để 'any' ở đây cho linh hoạt
  execution_command?: {
    targetId: number;
    count: number;
  };
  // SỬA LỖI: Thêm lại trường 'progress_log' vào interface
  progress_log?: string;
}

// ---- HÀM HANDLER CHÍNH CỦA NETLIFY FUNCTION ----
exports.handler = async function (event: { httpMethod: string; body: string }) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    const errorMessage =
      "Lỗi cấu hình: SUPABASE_URL hoặc SUPABASE_ANON_KEY chưa được thiết lập trên Netlify.";
    console.error(errorMessage);
    return { statusCode: 500, body: JSON.stringify({ error: errorMessage }) };
  }

  try {
    const payload = JSON.parse(event.body);
    console.log("Received payload from Supabase Webhook:", payload);

    const session: RemoteSession = payload.record;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (session.status === "url_submitted") {
      await processNewUrl(session, supabase);
    } else if (session.status === "execution_triggered") {
      await processExecution(session, supabase);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Worker executed successfully" }),
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred.";
    console.error("Error in Netlify function:", errorMessage);
    return { statusCode: 500, body: JSON.stringify({ error: errorMessage }) };
  }
};

// --- CÁC HÀM LOGIC ----

async function processNewUrl(session: RemoteSession, supabase: SupabaseClient) {
  if (!session.request_url) throw new Error("Request URL is missing.");
  console.log(
    `Processing URL for session ${session.id}: ${session.request_url}`
  );

  await updateSessionStatus(session.id, "processing", {}, supabase);

  const accessCode = session.request_url.split("/").pop();
  if (!accessCode) throw new Error("Could not parse access code from URL.");

  const response = await fetch(
    `https://audience.ahaslides.com/api/presentation/audience-data/${accessCode}`
  );
  if (!response.ok)
    throw new Error(`Failed to fetch AhaSlides data: ${response.statusText}`);

  // SỬA LỖI: Ép kiểu 'data' về 'AudienceData' để TypeScript hiểu
  const data = (await response.json()) as AudienceData;

  const relevantData = {
    question: data.name || "AhaSlides Question",
    options: data.SlideOptions.map((opt) => ({
      id: opt.id,
      title: opt.title,
      votesCount: opt.votesCount,
    })),
    internalDetails: {
      presentationId: data.presentationId,
      slideId: data.id,
      accessCode: data.presentation.accessCode,
      slideTimestamp: data.slideTimestamp,
      type: data.type,
      config: {
        timeToAnswer: data.timeToAnswer,
        multipleChoice: data.multipleChoice,
        isCorrectGetPoint: data.isCorrectGetPoint,
        stopSubmission: data.stopSubmission,
        fastAnswerGetMorePoint: data.fastAnswerGetMorePoint,
        showVotingResultsOnAudience: data.showVotingResultsOnAudience,
        version: data.version,
      },
    },
  };
  await updateSessionStatus(
    session.id,
    "data_returned",
    { session_data: relevantData },
    supabase
  );
}

async function processExecution(
  session: RemoteSession,
  supabase: SupabaseClient
) {
  if (!session.execution_command || !session.session_data)
    throw new Error("Execution command or session data is missing.");
  console.log(
    `Executing command for session ${session.id}:`,
    session.execution_command
  );

  await updateSessionStatus(session.id, "executing", {}, supabase);

  const { targetId, count } = session.execution_command;
  const details = session.session_data.internalDetails;
  let successfulVotes = 0;
  const apiUrl = "https://audience.ahaslides.com/api/answer/create";

  const templatePayload = {
    presentation: details.presentationId,
    slide: details.slideId,
    accessCode: details.accessCode,
    slideTimestamp: details.slideTimestamp,
    type: details.type,
    config: {
      ...details.config,
      quizTimestamp: [],
      otherCorrectQuiz: [],
    },
  };

  for (let i = 0; i < count; i++) {
    const votePayload = {
      ...templatePayload,
      audience: generateRandomAudienceId(),
      vote: [targetId],
    };
    try {
      const fetchResponse = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(votePayload),
      });
      if (fetchResponse.ok) successfulVotes++;

      if ((i + 1) % 10 === 0 || i === count - 1) {
        const progressMessage = `Đã gửi ${
          i + 1
        }/${count} vote... Thành công: ${successfulVotes}`;
        await updateSessionStatus(
          session.id,
          "executing",
          { progress_log: progressMessage },
          supabase
        );
      }
    } catch (error) {
      console.warn("Network error while sending vote, skipping...");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const finalMessage = `Hoàn thành! Gửi thành công ${successfulVotes}/${count} phiếu.`;
  await updateSessionStatus(
    session.id,
    "completed",
    { progress_log: finalMessage },
    supabase
  );
}

async function updateSessionStatus(
  sessionId: string,
  status: string,
  data: Partial<RemoteSession> = {},
  supabase: SupabaseClient
) {
  const { error } = await supabase
    .from("remote_sessions")
    .update({ status, ...data, updated_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (error) {
    console.error(`Error updating session ${sessionId}:`, error);
    throw error;
  }
}

function generateRandomAudienceId(): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
