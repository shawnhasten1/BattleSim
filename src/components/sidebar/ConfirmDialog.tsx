"use client";

import { createPortal } from "react-dom";
import { Modal } from "@/components/ui/Modal";
import modalStyles from "@/components/modals/modals.module.css";
import styles from "./ActorsPanel.module.css";

export interface ConfirmChoice {
  label: string;
  /** A choice that can't be undone from here, or loses something: shown in red. */
  danger?: boolean;
  /** Why it can't be chosen, when it can't. */
  blocked?: string;
  onSelect: () => void;
}

/**
 * A question from the Actors tab with a choice or two and Cancel (deleting an actor with tokens on the map, deleting a
 * folder). Portaled: the sidebar must not become the dialog's containing block.
 */
export function ConfirmDialog({ title, message, choices, onClose }: {
  title: string;
  message: string;
  choices: ConfirmChoice[];
  onClose: () => void;
}) {
  return createPortal(
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className={modalStyles.secondary} onClick={onClose}>Cancel</button>
          {choices.map((choice) => (
            <button
              key={choice.label} type="button"
              className={choice.danger ? `${modalStyles.primary} ${styles.dangerChoice}` : modalStyles.primary}
              disabled={Boolean(choice.blocked)} title={choice.blocked}
              onClick={() => { onClose(); choice.onSelect(); }}
            >
              {choice.label}
            </button>
          ))}
        </>
      }
    >
      <p className={styles.confirmMessage}>{message}</p>
    </Modal>,
    document.body
  );
}
