import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { APP_VERSION_SUBTITLE } from "../../lib/app_version";
import { BottomSheet } from "./BottomSheet";

export type MenuSection = {
  id: string;
  title: string;
  description: string;
  icon: string;
  iconBackgroundColor: string;
  backgroundColor: string;
  isDisabled?: boolean;
  accentColor?: string;
};

export const MENU_SECTIONS: MenuSection[] = [
  {
    id: "chatMode",
    title: "Configure Chat Mode",
    description: "Switch between voice and text",
    accentColor: "#E8F5E8",
    icon: "💬",
    iconBackgroundColor: "#EAFBF1",
    backgroundColor: "#F4FCF8",
    isDisabled: false,
  },
  {
    id: "language",
    title: "Configure Language",
    description: "Choose your preferred language.",
    icon: "🌍",
    iconBackgroundColor: "#E7F0FF",
    backgroundColor: "#F6F8FF",
    isDisabled: false,
  },
  {
    id: "voice",
    title: "Configure Voice",
    description: "Preview and choose real-time voices.",
    icon: "🎤",
    iconBackgroundColor: "#F8EEFF",
    backgroundColor: "#FBF5FF",
  },
  {
    id: "connectors",
    title: "Configure Connectors",
    description: "Connect to GitHub, Drive, and more.",
    icon: "🔗",
    iconBackgroundColor: "#E8F5FF",
    backgroundColor: "#F0F9FF",
  },
  {
    id: "advanced",
    title: "Advanced Configuration",
    description: "Adjust audio, chat, and model options.",
    icon: "⚙️",
    iconBackgroundColor: "#F1F1F1",
    backgroundColor: "#F7F7F7",
  },
  {
    id: "apiKey",
    title: "Configure API Key",
    description: "Manage your OpenAI credentials.",
    icon: "🔑",
    iconBackgroundColor: "#FFF3E6",
    backgroundColor: "#FFF8EF",
  },
  {
    id: "developer",
    title: "Developer",
    description: APP_VERSION_SUBTITLE,
    icon: "🛠️",
    iconBackgroundColor: "#FFE8D6",
    backgroundColor: "#FFF3E6",
    accentColor: "#FFE8D6",
  },
];

export interface HamburgerMenuProps {
  visible: boolean;
  onClose: () => void;
  onSelectSection?: (section: MenuSection) => void;
  sections?: MenuSection[];
}

export const HamburgerMenu: React.FC<HamburgerMenuProps> = ({
  visible,
  onClose,
  onSelectSection,
  sections = MENU_SECTIONS,
}) => {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Menu">
      <View style={styles.menuList}>
        {sections.map((section) => {
          const disabled = Boolean(section.isDisabled) || !onSelectSection;

          return (
            <Pressable
              key={section.id}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => {
                if (onSelectSection) {
                  onSelectSection(section);
                }
                onClose();
              }}
              style={({ pressed }) => [
                styles.menuItem,
                { backgroundColor: section.backgroundColor },
                pressed && !disabled ? styles.menuItemPressed : null,
              ]}
            >
              <View
                style={[
                  styles.menuIconContainer,
                  { backgroundColor: section.iconBackgroundColor },
                ]}
              >
                <Text style={styles.menuIcon}>{section.icon}</Text>
              </View>
              <View style={styles.menuTexts}>
                <Text style={styles.menuTitle}>{section.title}</Text>
                <Text style={styles.menuSubtitle}>{section.description}</Text>
              </View>
              <Text style={styles.menuChevron}>›</Text>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  menuList: {
    gap: 12,
    paddingBottom: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 16,
  },
  menuItemPressed: {
    opacity: 0.85,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  menuIcon: {
    fontSize: 20,
  },
  menuTexts: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  menuSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: "#6E6E73",
  },
  menuChevron: {
    fontSize: 18,
    color: "#8E8E93",
  },
});

const CHAT_MODE_TINT = "#E8F5E8";
const DEVELOPER_TINT = "#FFE8D6";
