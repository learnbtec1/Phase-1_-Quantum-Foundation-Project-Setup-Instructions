'use client';  
  
import React from 'react';  
import styles from './Chat.module.css';  
  
export default function ChatInputRow({ children }: { children: React.ReactNode }) {  
  return <div className={styles.chatInputRow}>{children}</div>;  
} 
