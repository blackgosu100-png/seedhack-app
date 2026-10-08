// 로켓그로스 대시보드와 같은 회원 시스템(Supabase) — 공개용(anon) 키라 앱에 넣어도 되는 값(웹사이트에도 공개됨).
// 수강생 승인 확인은 대시보드 서버 API가 비밀 키로 처리하므로 앱에는 비밀 키가 없다.
export const SUPABASE_URL = "https://tmjywvohuevpvevdhrxc.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtanl3dm9odWV2cHZldmRocnhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMTM0MTQsImV4cCI6MjA5Nzc4OTQxNH0.FNVVquApGdBEKd7NvV27ADvtb3jKYZLrvbRtqDB-jvg";
// 대시보드와 같은 기본 관리자(회원 승인 없이 통과) — 대시보드 admin-access.js DEFAULT_ADMIN_EMAILS와 맞출 것
export const ADMIN_EMAILS = ["noahpark12@naver.com"];
export const DASHBOARD_URL = "https://rocketgrowth-sale-dashboard.vercel.app";
