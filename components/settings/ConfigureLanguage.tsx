import React, { useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { BottomSheet } from "../ui/BottomSheet";

export interface ConfigureLanguageProps {
  visible: boolean;
  selectedLanguage: string;
  onSelectLanguage: (language: string) => void;
  onClose: () => void;
}

type LanguageOption = {
  name: string;
  flag: string;
  tier: "excellent" | "good";
};

const SUPPORTED_LANGUAGES: LanguageOption[] = [
  // Tier 1 - Near-native performance (5 stars)
  { name: "English", flag: "🇺🇸", tier: "excellent" },
  { name: "Spanish", flag: "🇪🇸", tier: "excellent" },
  { name: "French", flag: "🇫🇷", tier: "excellent" },
  { name: "German", flag: "🇩🇪", tier: "excellent" },
  { name: "Italian", flag: "🇮🇹", tier: "excellent" },
  { name: "Portuguese", flag: "🇧🇷", tier: "excellent" },
  { name: "Dutch", flag: "🇳🇱", tier: "excellent" },

  // Tier 2 - Very good (4 stars)
  { name: "Japanese", flag: "🇯🇵", tier: "good" },
  { name: "Korean", flag: "🇰🇷", tier: "good" },
  { name: "Mandarin Chinese", flag: "🇨🇳", tier: "good" },
  { name: "Russian", flag: "🇷🇺", tier: "good" },
  { name: "Hindi", flag: "🇮🇳", tier: "good" },
  { name: "Arabic", flag: "🇸🇦", tier: "good" },
];

export const ConfigureLanguage: React.FC<ConfigureLanguageProps> = ({
  visible,
  selectedLanguage,
  onSelectLanguage,
  onClose,
}) => {
  const [customLanguage, setCustomLanguage] = useState("");

  const handleSelectLanguage = (language: string) => {
    onSelectLanguage(language);
    setCustomLanguage("");
    Keyboard.dismiss();
  };

  const handleCustomLanguageSubmit = () => {
    const trimmed = customLanguage.trim();
    if (trimmed.length > 0) {
      onSelectLanguage(trimmed);
      setCustomLanguage("");
      Keyboard.dismiss();
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Configure Language">
      <ScrollView
        contentContainerStyle={styles.body}
        style={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>
          Select your preferred language. Arty will respond in this language.
        </Text>

        <View style={styles.tierSection}>
          <Text style={styles.tierHeader}>⭐ Excellent Support</Text>
          <Text style={styles.tierSubtext}>
            Near-native quality • Natural TTS • High accuracy
          </Text>
        </View>

        <View style={styles.languageList}>
          {SUPPORTED_LANGUAGES.filter((lang) => lang.tier === "excellent").map(
            (language) => {
              const isSelected = selectedLanguage === language.name;
              return (
                <Pressable
                  key={language.name}
                  onPress={() => handleSelectLanguage(language.name)}
                  style={({ pressed }) => [
                    styles.languageOption,
                    isSelected && styles.languageOptionSelected,
                    pressed && styles.languageOptionPressed,
                  ]}
                >
                  <View style={styles.languageOptionContent}>
                    <Text style={styles.languageFlag}>{language.flag}</Text>
                    <Text
                      style={[
                        styles.languageLabel,
                        isSelected && styles.languageLabelSelected,
                      ]}
                    >
                      {language.name}
                    </Text>
                  </View>
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </Pressable>
              );
            },
          )}
        </View>

        <View style={styles.tierSection}>
          <Text style={styles.tierHeader}>✅ Very Good Support</Text>
          <Text style={styles.tierSubtext}>
            Reliable • Good quality • Occasional quirks
          </Text>
        </View>

        <View style={styles.languageList}>
          {SUPPORTED_LANGUAGES.filter((lang) => lang.tier === "good").map(
            (language) => {
              const isSelected = selectedLanguage === language.name;
              return (
                <Pressable
                  key={language.name}
                  onPress={() => handleSelectLanguage(language.name)}
                  style={({ pressed }) => [
                    styles.languageOption,
                    isSelected && styles.languageOptionSelected,
                    pressed && styles.languageOptionPressed,
                  ]}
                >
                  <View style={styles.languageOptionContent}>
                    <Text style={styles.languageFlag}>{language.flag}</Text>
                    <Text
                      style={[
                        styles.languageLabel,
                        isSelected && styles.languageLabelSelected,
                      ]}
                    >
                      {language.name}
                    </Text>
                  </View>
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </Pressable>
              );
            },
          )}
        </View>

        <View style={styles.customSection}>
          <Text style={styles.customLabel}>Other Language</Text>
          <TextInput
            style={styles.customInput}
            placeholder="Enter language name..."
            placeholderTextColor="#8E8E93"
            value={customLanguage}
            onChangeText={setCustomLanguage}
            onSubmitEditing={handleCustomLanguageSubmit}
            returnKeyType="done"
            autoCapitalize="words"
            autoCorrect={false}
          />
          <Pressable
            style={({ pressed }) => [
              styles.customButton,
              !customLanguage.trim() && styles.customButtonDisabled,
              pressed && customLanguage.trim() && styles.customButtonPressed,
            ]}
            onPress={handleCustomLanguageSubmit}
            disabled={!customLanguage.trim()}
          >
            <Text
              style={[
                styles.customButtonText,
                !customLanguage.trim() && styles.customButtonTextDisabled,
              ]}
            >
              Set Language
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  scrollContainer: {
    maxHeight: 600,
  },
  lead: {
    fontSize: 15,
    color: "#636366",
    lineHeight: 22,
    marginBottom: 20,
  },
  tierSection: {
    marginTop: 8,
    marginBottom: 12,
  },
  tierHeader: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1C1C1E",
    marginBottom: 4,
  },
  tierSubtext: {
    fontSize: 12,
    color: "#8E8E93",
    lineHeight: 16,
  },
  languageList: {
    gap: 10,
    marginBottom: 20,
  },
  languageOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E5E5EA",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  languageOptionSelected: {
    borderColor: "#0A84FF",
    backgroundColor: "#F0F8FF",
  },
  languageOptionPressed: {
    backgroundColor: "#F5F5F7",
  },
  languageOptionContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  languageFlag: {
    fontSize: 24,
  },
  languageLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  languageLabelSelected: {
    color: "#0A84FF",
  },
  checkmark: {
    fontSize: 18,
    color: "#0A84FF",
    marginLeft: 12,
  },
  customSection: {
    borderTopWidth: 1,
    borderTopColor: "#E5E5EA",
    paddingTop: 24,
  },
  customLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  customInput: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#C7C7CC",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#1C1C1E",
    marginBottom: 12,
  },
  customButton: {
    backgroundColor: "#0A84FF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  customButtonDisabled: {
    backgroundColor: "#E5E5EA",
  },
  customButtonPressed: {
    backgroundColor: "#0066CC",
  },
  customButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  customButtonTextDisabled: {
    color: "#8E8E93",
  },
});
