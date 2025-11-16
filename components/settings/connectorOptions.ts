export type ConnectorId = "github" | "gdrive" | "web";

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
];
