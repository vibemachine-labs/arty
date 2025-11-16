export type ConnectorId = "github" | "gdrive" | "web" | "hacker_news" | "deepwiki" | "daily_papers";

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
    id: "gdrive",
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
    id: "daily_papers",
    name: "Daily Papers",
    icon: "📰",
    backgroundColor: "#FFF0F5",
    iconBackgroundColor: "#FFE4EC",
  },
];
