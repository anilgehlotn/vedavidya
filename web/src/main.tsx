import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { DEMO } from "./lib/api";
import { DemoBanner } from "./components/DemoBanner";
import "./styles.css";
import "./site.css";

// Lets CSS hide scroll-reveal elements only when JS can reveal them again.
document.documentElement.classList.add("js");
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./components/toast";
import SiteLayout from "./pages/site/SiteLayout";
import Home from "./pages/site/Home";
import About from "./pages/site/About";
import Contact from "./pages/site/Contact";
import Login from "./pages/site/Login";
import PublicReport from "./pages/site/PublicReport";
import AppLayout from "./pages/app/AppLayout";
import Overview from "./pages/app/Overview";
import { Batches, Notices, Settings, StaffPage, Students } from "./pages/app/Institute";
import { PaperDetail, PaperGenerate, PaperList } from "./pages/app/Papers";
import { AttemptReview, TestDetail, TestList } from "./pages/app/Tests";
import { Analytics, StudentReport } from "./pages/app/Analytics";
import { CbtExam, MyTests } from "./pages/app/Student";
import { PracticePlayer } from "./pages/app/Insights";
import Platform from "./pages/app/Platform";
import Practice from "./pages/app/Practice";

// The preview runs inside a frame without real URLs, so it keeps routes in memory.
const Router = ({ children }: { children: React.ReactNode }) =>
  DEMO ? <MemoryRouter>{children}</MemoryRouter> : <BrowserRouter>{children}</BrowserRouter>;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router>
      {DEMO && <DemoBanner />}
      <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
          </Route>
          <Route path="/login" element={<Login />} />
          <Route path="/report/:token" element={<PublicReport />} />
          <Route path="/exam/:testId" element={<CbtExam />} />
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Overview />} />
            <Route path="batches" element={<Batches />} />
            <Route path="students" element={<Students />} />
            <Route path="students/:id" element={<StudentReport />} />
            <Route path="teachers" element={<StaffPage />} />
            <Route path="notices" element={<Notices />} />
            <Route path="settings" element={<Settings />} />
            <Route path="platform" element={<Platform />} />
            <Route path="papers" element={<PaperList />} />
            <Route path="papers/new" element={<PaperGenerate />} />
            <Route path="papers/:id" element={<PaperDetail />} />
            <Route path="tests" element={<TestList />} />
            <Route path="tests/:id" element={<TestDetail />} />
            <Route path="attempts/:id" element={<AttemptReview />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="my" element={<MyTests />} />
            <Route path="my/report" element={<StudentReport self />} />
            <Route path="practice" element={<Practice />} />
            <Route path="practice/:id" element={<PracticePlayer />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
      </ToastProvider>
    </Router>
  </React.StrictMode>,
);
