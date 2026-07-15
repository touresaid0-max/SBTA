import { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, ChevronDown } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ChatMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export default function ChatInbox() {
  const { user } = useAuthStore();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [adminName, setAdminName] = useState('Admin');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    loadUnreadCount();
    const channel = supabase
      .channel(`inbox-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'admin_chat_messages',
        filter: `receiver_id=eq.${user.id}`,
      }, (payload) => {
        const msg = payload.new as ChatMessage;
        if (isOpen) {
          setMessages(prev => [...prev, msg]);
          markAsRead(msg.id);
        } else {
          setUnreadCount(c => c + 1);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, isOpen]);

  useEffect(() => {
    if (isOpen) {
      loadMessages();
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadUnreadCount = async () => {
    if (!user) return;
    const { count } = await supabase
      .from('admin_chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_id', user.id)
      .eq('is_read', false);
    setUnreadCount(count || 0);
  };

  const loadMessages = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('admin_chat_messages')
      .select('*')
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('created_at', { ascending: true })
      .limit(50);

    if (data && data.length > 0) {
      setMessages(data);
      const firstAdminMsg = data.find(m => m.sender_id !== user.id);
      if (firstAdminMsg) {
        setAdminId(firstAdminMsg.sender_id);
        loadAdminName(firstAdminMsg.sender_id);
      }
      const unread = data.filter(m => m.receiver_id === user.id && !m.is_read);
      unread.forEach(m => markAsRead(m.id));
      setUnreadCount(0);
    }
  };

  const loadAdminName = async (id: string) => {
    const { data } = await supabase
      .from('users')
      .select('full_name, first_name, last_name')
      .eq('id', id)
      .maybeSingle();
    if (data) {
      setAdminName(data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Admin');
    }
  };

  const markAsRead = async (msgId: string) => {
    await supabase
      .from('admin_chat_messages')
      .update({ is_read: true })
      .eq('id', msgId);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user || sending || !adminId) return;
    setSending(true);
    const { data, error } = await supabase
      .from('admin_chat_messages')
      .insert({
        sender_id: user.id,
        receiver_id: adminId,
        content: newMessage.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setMessages(prev => [...prev, data]);
      setNewMessage('');
    }
    setSending(false);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
        style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {isOpen ? <ChevronDown className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
        {!isOpen && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-[360px] h-[480px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden animate-slide-in"
          style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-teal-50">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white text-xs font-bold">
                A
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{adminName}</p>
                <p className="text-[10px] text-gray-500">Administration</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 bg-gray-50/40">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <MessageCircle className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-xs">Aucun message pour le moment</p>
              </div>
            )}
            {messages.map((msg) => {
              const isMine = msg.sender_id === user?.id;
              return (
                <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-2xl ${
                    isMine
                      ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-br-md'
                      : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md shadow-sm'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    <p className={`text-[9px] mt-0.5 ${isMine ? 'text-emerald-100' : 'text-gray-400'}`}>
                      {format(new Date(msg.created_at), 'HH:mm', { locale: fr })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={sendMessage} className="px-3 py-2.5 border-t border-gray-100 bg-white">
            {!adminId && messages.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-1">En attente d'un message de l'admin</p>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Votre r&#233;ponse..."
                  className="flex-1 px-3.5 py-2 rounded-full border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim() || sending || !adminId}
                  className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center hover:shadow-md transition-all disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </form>
        </div>
      )}
    </>
  );
}
