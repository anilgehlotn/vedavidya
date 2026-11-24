import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Shown only in the browser preview build.
export function DemoBanner() {
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <div className="demo-banner" role="note">
      Preview with sample data · changes aren't saved · AI grading and paper generation need the full app
    </div>
  );
}
