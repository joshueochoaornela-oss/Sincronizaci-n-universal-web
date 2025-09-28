import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, deleteDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';

// Define global variables as empty strings to be populated by the Canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase App
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// Main App component
const App = () => {
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [signals, setSignals] = useState([]);
  const [currentSignal, setCurrentSignal] = useState('');
  const [currentFeeling, setCurrentFeeling] = useState('');
  const [currentBodySensation, setCurrentBodySensation] = useState('');
  const [currentThought, setCurrentThought] = useState('');
  const [currentCategory, setCurrentCategory] = useState('Personal');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncHistory, setSyncHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Firebase authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        await signInAnonymously(auth);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // LLM API stub (dejar vacío el apiKey, usar backend seguro)
  const generateSolution = async (contractionSignal, expansionSignal) => {
    const prompt = `Basándote en una señal de contracción (miedo, incertidumbre) y una posterior señal de expansión (calma, claridad) que contiene la palabra "resonancia", genera una solución o un "siguiente paso" a seguir. La solución debe ser una frase corta y precisa que conecte ambos eventos.\n\n    Contracción:\n    - Evento: ${contractionSignal.text}\n    - Pensamiento: ${contractionSignal.thought}\n    - Sentimiento: ${contractionSignal.feeling}\n    - Sensación Corporal: ${contractionSignal.bodySensation}\n\n    Expansión (Resonancia):\n    - Evento: ${expansionSignal.text}\n    - Pensamiento: ${expansionSignal.thought}\n    - Sentimiento: ${expansionSignal.feeling}\n    - Sensación Corporal: ${expansionSignal.bodySensation}\n\n    Genera la solución en español. Ejemplo: "La incertidumbre del proyecto te invitó a confiar en que la ayuda llegaría de fuentes inesperadas."`;

    try {
      let chatHistory = [];
      chatHistory.push({ role: "user", parts: [{ text: prompt }] });
      const payload = { contents: chatHistory };
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      
      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const text = result.candidates[0].content.parts[0].text;
        return text;
      } else {
        console.error("Unexpected API response structure:", result);
        return "No se pudo generar una solución. Intenta de nuevo.";
      }
    } catch (e) {
      console.error("Error generating solution:", e);
      return "Hubo un error al generar la solución.";
    }
  };

  // Fetch and synchronize data from Firestore
  useEffect(() => {
    if (isAuthReady && user) {
      const userId = user.uid;
      const signalsRef = collection(db, `artifacts/${appId}/users/${userId}/signals`);
      const syncHistoryRef = collection(db, `artifacts/${appId}/users/${userId}/syncHistory`);
      const unsubscribeSignals = onSnapshot(signalsRef, (snapshot) => {
        const fetchedSignals = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        setSignals(fetchedSignals);
        checkSynchronization(fetchedSignals);
        setIsLoading(false);
      });
      const unsubscribeSyncHistory = onSnapshot(syncHistoryRef, (snapshot) => {
        const fetchedHistory = snapshot.docs.map(doc => doc.data());
        setSyncHistory(fetchedHistory.sort((a,b) => b.timestamp?.seconds - a.timestamp?.seconds));
        setIsLoading(false);
      });
      return () => {
        unsubscribeSignals();
        unsubscribeSyncHistory();
      };
    }
  }, [isAuthReady, user, db]);

  // Synchronization logic
  const checkSynchronization = (currentSignals) => {
    const contractionKeywords = ['desesperacion', 'hambre', 'miedo', 'tensión', 'incertidumbre', 'preocupacion'];
    const expansionKeywords = ['calma', 'lleno', 'seguridad', 'relajación', 'claridad', 'tranquilidad'];

    if (currentSignals.length >= 2) {
      setIsSyncing(true);
      setSyncMessage('Detectando la sincronización...');
      const syncTimeout = setTimeout(async () => {
        const personalSignals = currentSignals.filter(s => s.category === 'Personal');
        const financialSignals = currentSignals.filter(s => s.category === 'Financiero');
        const lastPersonalSignal = personalSignals[personalSignals.length - 1];
        const lastFinancialSignal = financialSignals[financialSignals.length - 1];
        const firstPersonalSignal = personalSignals[0];
        const firstFinancialSignal = financialSignals[0];

        const isContraction = (signal) => {
          if (!signal) return false;
          const feeling = signal.feeling?.toLowerCase() || '';
          const thought = signal.thought?.toLowerCase() || '';
          return contractionKeywords.some(keyword => feeling.includes(keyword) || thought.includes(keyword));
        };

        const isExpansionResonance = (signal) => {
          if (!signal) return false;
          const feeling = signal.feeling?.toLowerCase() || '';
          const text = signal.text?.toLowerCase() || '';
          return text.includes('resonancia') && expansionKeywords.some(keyword => feeling.includes(keyword));
        };

        // Personal
        if (personalSignals.length >= 2 && isContraction(firstPersonalSignal) && isExpansionResonance(lastPersonalSignal)) {
          const solution = await generateSolution(firstPersonalSignal, lastPersonalSignal);
          const newSyncEvent = {
            message: `[PERSONAL] ¡Dualidad de resonancia detectada! La contracción del universo personal se ha sincronizado con la expansión.`,
            solution: solution,
            timestamp: serverTimestamp()
          };
          setSyncMessage('¡Sincronización personal detectada! El flujo se ha revelado.');
          await addDoc(collection(db, `artifacts/${appId}/users/${user.uid}/syncHistory`), newSyncEvent);
        }

        // Financiero
        if (financialSignals.length >= 2 && isContraction(firstFinancialSignal) && isExpansionResonance(lastFinancialSignal)) {
          const solution = await generateSolution(firstFinancialSignal, lastFinancialSignal);
          const newSyncEvent = {
            message: `[FINANCIERO] ¡Dualidad de resonancia detectada! La contracción del mercado se ha sincronizado con la expansión.`,
            solution: solution,
            timestamp: serverTimestamp()
          };
          setSyncMessage('¡Sincronización financiera detectada! El flujo se ha revelado.');
          await addDoc(collection(db, `artifacts/${appId}/users/${user.uid}/syncHistory`), newSyncEvent);
        }
        setIsSyncing(false);
      }, 2000);
      return () => clearTimeout(syncTimeout);
    }
  };

  // Add signal to Firestore
  const handleAddSignal = async () => {
    if (!user || !currentSignal.trim()) return;
    const signalData = {
      text: currentSignal,
      thought: currentThought,
      feeling: currentFeeling,
      category: currentCategory,
      bodySensation: currentBodySensation,
      timestamp: serverTimestamp(),
    };
    try {
      await addDoc(collection(db, `artifacts/${appId}/users/${user.uid}/signals`), signalData);
      setCurrentSignal('');
      setCurrentThought('');
      setCurrentFeeling('');
      setCurrentCategory('Personal');
      setCurrentBodySensation('');
    } catch (e) {
      console.error("Error adding document: ", e);
    }
  };

  // Clear all signals
  const handleClearSignals = async () => {
    if (!user) return;
    try {
      const userId = user.uid;
      const signalsRef = collection(db, `artifacts/${appId}/users/${userId}/signals`);
      const signalsSnapshot = await getDocs(signalsRef);
      const deletePromises = signalsSnapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);

      const syncHistoryRef = collection(db, `artifacts/${appId}/users/${userId}/syncHistory`);
      const syncHistorySnapshot = await getDocs(syncHistoryRef);
      const deleteHistoryPromises = syncHistorySnapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deleteHistoryPromises);

      setSignals([]);
      setSyncHistory([]);
      setSyncMessage('');
    } catch (e) {
      console.error("Error clearing documents: ", e);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center">
        <div className="text-xl font-bold">Cargando datos...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8 flex flex-col items-center">
      <div className="text-right w-full max-w-4xl mb-4 text-sm text-gray-500">
        <p>ID de usuario: {user?.uid || 'Cargando...'}</p>
      </div>
      <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-4xl w-full">
        <h1 className="text-4xl font-extrabold text-white text-center mb-6">Aplicación SSFU</h1>
        <p className="text-xl text-center text-gray-400 mb-8">
          Captura las señales y resonancias del universo para encontrar la sincronización.
        </p>
        {/* Input section */}
        <div className="flex flex-col gap-4 mb-8">
          <input
            type="text"
            className="w-full p-4 rounded-xl bg-gray-700 border-2 border-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
            placeholder="Introduce una señal o evento del universo..."
            value={currentSignal}
            onChange={(e) => setCurrentSignal(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddSignal()}
          />
          <input
            type="text"
            className="w-full p-4 rounded-xl bg-gray-700 border-2 border-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
            placeholder="Pensamiento (ej: 'esto no va a funcionar')..."
            value={currentThought}
            onChange={(e) => setCurrentThought(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddSignal()}
          />
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <select
              className="flex-grow p-4 rounded-xl bg-gray-700 border-2 border-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
              value={currentCategory}
              onChange={(e) => setCurrentCategory(e.target.value)}
            >
              <option value="Personal">Personal</option>
              <option value="Financiero">Financiero</option>
            </select>
            <input
              type="text"
              className="flex-grow p-4 rounded-xl bg-gray-700 border-2 border-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
              placeholder="Sentimiento (ej: calma, intuición)..."
              value={currentFeeling}
              onChange={(e) => setCurrentFeeling(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddSignal()}
            />
            <input
              type="text"
              className="flex-grow p-4 rounded-xl bg-gray-700 border-2 border-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
              placeholder="Sensación corporal (ej: dolor de cabeza)..."
              value={currentBodySensation}
              onChange={(e) => setCurrentBodySensation(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddSignal()}
            />
          </div>
          <button
            onClick={handleAddSignal}
            className="bg-purple-600 text-white font-bold py-4 px-8 rounded-xl shadow-lg hover:bg-purple-700 transition-colors transform hover:scale-105 mt-4"
          >
            Añadir Señal
          </button>
        </div>
        {/* Display for signals and sync history */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Signals list */}
          <div className="bg-gray-700 p-6 rounded-xl shadow-inner">
            <h2 className="text-2xl font-bold mb-4 text-purple-400">Señales del Universo</h2>
            {signals.length === 0 ? (
              <p className="text-gray-500">Aún no se han añadido señales. Intenta escribir una.</p>
            ) : (
              <ul className="space-y-4">
                {signals.map((signal) => (
                  <li key={signal.id} className="bg-gray-800 p-4 rounded-lg flex flex-col items-start transform hover:scale-105 transition-transform duration-200">
                    <span className="text-purple-300 font-bold mb-1">Categoría: {signal.category}</span>
                    <span className="text-gray-200 mb-1">{signal.text}</span>
                    <span className="text-sm text-gray-400 mb-1">Pensamiento: {signal.thought || 'N/A'}</span>
                    <span className="text-sm text-gray-400 mb-1">Sentimiento: {signal.feeling || 'N/A'}</span>
                    <span className="text-sm text-gray-400 mb-1">Sensación Corporal: {signal.bodySensation || 'N/A'}</span>
                    <span className="self-end text-xs text-gray-500">
                      {signal.timestamp?.seconds ? new Date(signal.timestamp.seconds * 1000).toLocaleTimeString() : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Sync status and history */}
          <div className="bg-gray-700 p-6 rounded-xl shadow-inner">
            <h2 className="text-2xl font-bold mb-4 text-purple-400">Sincronización Detectada</h2>
            <div className={`p-4 rounded-lg text-white font-semibold mb-4 ${isSyncing ? 'bg-yellow-500 animate-pulse' : 'bg-green-600'}`}> 
              {isSyncing ? syncMessage : syncMessage || 'Esperando señales para sincronizar...'}
            </div>
            {syncHistory.length > 0 && (
              <div>
                <h3 className="text-xl font-bold mb-2 text-purple-300">Historial de Sincronización</h3>
                <ul className="space-y-4">
                  {syncHistory.map((event, index) => (
                    <li key={index} className="bg-gray-800 p-4 rounded-lg flex flex-col items-start transform hover:scale-105 transition-transform duration-200">
                      <span className="text-purple-300 font-bold mb-1">{event.message}</span>
                      <p className="text-white mt-2">**Solución:** {event.solution}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        {/* Clear button */}
        <div className="mt-8 text-center">
          <button
            onClick={handleClearSignals}
            className="bg-red-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:bg-red-700 transition-colors transform hover:scale-105"
          >
            Limpiar Todo
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;