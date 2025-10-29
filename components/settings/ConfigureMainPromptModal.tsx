import React from "react";

import {
  BASE_MAIN_PROMPT,
  loadMainPromptAddition,
  saveMainPromptAddition,
} from "../../lib/mainPrompt";
import { ConfigurePromptModal } from "./ConfigurePromptModal";

interface ConfigureMainPromptModalProps {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export const ConfigureMainPromptModal: React.FC<ConfigureMainPromptModalProps> = ({
  visible,
  value,
  onChange,
  onClose,
  onSave,
}) => (
  <ConfigurePromptModal
    visible={visible}
    value={value}
    onChange={onChange}
    onClose={onClose}
    onSaveSuccess={onSave}
    loadPromptAddition={loadMainPromptAddition}
    savePromptAddition={saveMainPromptAddition}
    basePrompt={BASE_MAIN_PROMPT}
    title="Configure Main Prompt"
  />
);
