export type ConnectorId =
  | "github"
  | "google_drive"
  | "web"
  | "hacker_news"
  | "deepwiki"
  | "context7"
  | "daily_papers"
  | "github_legacy"
  | "gdrive_legacy";

export type ConnectorOption = {
  id: ConnectorId;
  name: string;
  icon: string;
  backgroundColor: string;
  iconBackgroundColor: string;
  isConfigured?: boolean;
};

export const CONNECTOR_OPTIONS: ConnectorOption[] = [
  {
    id: "github",
    name: "GitHub",
    icon: "🐙",
    backgroundColor: "#F6F8FF",
    iconBackgroundColor: "#E7F0FF",
  },
  {
    id: "google_drive",
    name: "Google Drive",
    icon: "📂",
    backgroundColor: "#FFF8EF",
    iconBackgroundColor: "#FFF3E6",
  },
  {
    id: "web",
    name: "Web",
    icon: "🌐",
    backgroundColor: "#F4FCF8",
    iconBackgroundColor: "#EAFBF1",
  },
  {
    id: "hacker_news",
    name: "Hacker News",
    icon: "🗞️",
    backgroundColor: "#FFF4E6",
    iconBackgroundColor: "#FFE8CC",
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    icon: "📚",
    backgroundColor: "#F0F4FF",
    iconBackgroundColor: "#E0EAFF",
  },
  {
    id: "context7",
    name: "Context7",
    icon: "📖",
    backgroundColor: "#F4F0FF",
    iconBackgroundColor: "#E8DCFF",
  },
  {
    id: "daily_papers",
    name: "Daily Papers",
    icon: "📰",
    backgroundColor: "#FFF0F5",
    iconBackgroundColor: "#FFE4EC",
  },
  {
    id: "github_legacy",
    name: "GitHub (Legacy)",
    icon: "🔧",
    backgroundColor: "#F6F8FF",
    iconBackgroundColor: "#E7F0FF",
  },
  {
    id: "gdrive_legacy",
    name: "GDrive (Legacy)",
    icon: "🔧",
    backgroundColor: "#FFF8EF",
    iconBackgroundColor: "#FFF3E6",
  },
];
