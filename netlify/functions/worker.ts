import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// Các kiểu dữ liệu có thể copy từ worker cũ hoặc định nghĩa lại ở đây
interface RemoteSession {
  id: string;
  status: string;
  request_url?: string;
  session_data?: any;
  execution_command?: {
    targetId: number;
    count: number;
  };
}

// Hàm handler chính của Netlify Function
exports.handler = async function (event) {
  // Chỉ chấp nhận phương thức POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Lấy dữ liệu từ body của webhook do Supabase gửi
    const payload = JSON.parse(event.body);
    console.log("Received payload from Supabase Webhook:", payload);

    // Dữ liệu của hàng được thêm/sửa nằm trong payload.record
    const session: RemoteSession = payload.record;

    const SUPABASE_URL = "https://klkqhcmvsfcbindhodru.supabase.co";
    const SUPABASE_ANON_KEY =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtsa3FoY212c2ZjYmluZGhvZHJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE0NzI2OTksImV4cCI6MjA2NzA0ODY5OX0.zgYtYET9saIdLGPeSvvWUdn8NQ5VUQ9ULmhynedHqvQ";

    // Khởi tạo Supabase client bên trong function
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Dựa vào trạng thái để gọi hàm xử lý tương ứng
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
    console.error("Error in Netlify function:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

// --- Các hàm logic (gần như giữ nguyên từ worker cũ) ---

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
  const data = await response.json();

  const relevantData = {
    /* ... copy y hệt object relevantData từ worker cũ ... */
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

  // ... copy y hệt toàn bộ logic của hàm processExecution từ worker cũ ...
  // Chỉ cần thêm tham số 'supabase' vào các lời gọi updateSessionStatus
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

// Bạn cũng cần copy các hàm phụ trợ khác như generateRandomAudienceId nếu có
