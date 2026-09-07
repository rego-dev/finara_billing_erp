'use client';
import { motion } from 'framer-motion';

export default function BrowserFrame({ src, alt, priority = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, ease: [0.22, 0.68, 0, 1] }}
      className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-[0_24px_60px_-12px_rgba(0,56,168,0.18)]"
    >
      <div className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
        <span className="ml-3 flex-1 max-w-xs h-5 rounded-md bg-white border border-gray-200 text-[10px] text-gray-400 flex items-center px-2 truncate">
          {alt}
        </span>
      </div>
      <img src={src} alt={alt} loading={priority ? 'eager' : 'lazy'} className="w-full h-auto block" />
    </motion.div>
  );
}
