import { useAppPaths } from "../../app/paths";
import { usePageTitle } from "../../hooks/usePageTitle";
import { AboutContent } from "./AboutContent";
import "./about.css";

export function AboutPage() {
  usePageTitle("서비스 소개");
  const paths = useAppPaths();
  return <AboutContent briefing={paths.briefing} rank={paths.rank} history={paths.history} />;
}
