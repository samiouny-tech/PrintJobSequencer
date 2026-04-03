/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { 
  Undo2, 
  Play, 
  Upload, 
  Download, 
  GripVertical, 
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  LayoutDashboard,
  Info
} from 'lucide-react';
import { motion, Reorder, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { SequenceRow, ScoreResults } from './types';
import { calculateScore } from './utils/scoring';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<SequenceRow[]>([]);
  const [history, setHistory] = useState<SequenceRow[][]>([]);
  const [scoreResults, setScoreResults] = useState<ScoreResults | null>(null);
  const [draggedCell, setDraggedCell] = useState<{ rowIndex: number; colIndex: number } | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  const [isPaneVisible, setIsPaneVisible] = useState(true);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colIndex: number } | null>(null);
  const [fixTopRow, setFixTopRow] = useState(true);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // Dynamic column detection
  const aniloxIndices = headers.reduce((acc, h, i) => h.toLowerCase().startsWith('anilox') ? [...acc, i] : acc, [] as number[]);
  const inkIndices = headers.reduce((acc, h, i) => h.toLowerCase().startsWith('ink') ? [...acc, i] : acc, [] as number[]);

  const loadSampleData = useCallback(() => {
    fetch('/sample_data.csv')
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load sample data: ${res.statusText}`);
        return res.text();
      })
      .then(csvText => {
        Papa.parse(csvText, {
          complete: (results) => {
            const data = results.data as string[][];
            if (data.length > 0) {
              const headerRow = data[0];
              const headerLength = headerRow.length;
              setHeaders(headerRow);
              const initialRows = data.slice(1)
                .filter(r => r.length > 0)
                .map((r, i) => {
                  const paddedData = Array.from({ length: headerLength }, (_, idx) => {
                    const val = r[idx];
                    return (val === undefined || val === null) ? "" : String(val);
                  });
                  return { id: `row-${i}-${Date.now()}`, data: paddedData };
                });
              setRows(initialRows);
              setHistory([]);
              setScoreResults(null);
            }
          }
        });
      })
      .catch(err => {
        console.error("Error loading sample data:", err);
      });
  }, []);

  // Load default data
  useEffect(() => {
    loadSampleData();
  }, [loadSampleData]);

  const saveToHistory = useCallback(() => {
    setHistory(prev => [...prev, JSON.parse(JSON.stringify(rows))]);
  }, [rows]);

  const undo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setRows(previous);
    setHistory(prev => prev.slice(0, -1));
    setScoreResults(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      if (file.name.endsWith('.csv')) {
        Papa.parse(bstr as string, {
          complete: (results) => {
            const data = results.data as string[][];
            processData(data);
          }
        });
      } else {
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
        processData(data);
      }
    };
    
    if (file.name.endsWith('.csv')) {
      reader.readAsText(file);
    } else {
      reader.readAsBinaryString(file);
    }
  };

  const processData = (data: string[][]) => {
    if (data.length > 0) {
      saveToHistory();
      const headerRow = data[0];
      const headerLength = headerRow.length;
      setHeaders(headerRow);
      
      const newRows = data.slice(1)
        .filter(r => r.length > 0)
        .map((r, i) => {
          // Pad row to match header length to prevent cells from moving left
          const paddedData = Array.from({ length: headerLength }, (_, idx) => {
            const val = r[idx];
            return (val === undefined || val === null) ? "" : String(val);
          });
          return { id: `row-${Date.now()}-${i}`, data: paddedData };
        });
      setRows(newRows);
      setScoreResults(null);
    }
  };

  const handleScore = () => {
    setIsScoring(true);
    setIsPaneVisible(true);
    setTimeout(() => {
      const results = calculateScore(headers, rows.map(r => r.data), aniloxIndices, inkIndices);
      setScoreResults(results);
      setIsScoring(false);
    }, 500);
  };

  const handleOptimize = async () => {
    if (rows.length === 0) return;
    setIsOptimizing(true);
    saveToHistory();

    try {
      const response = await fetch('/api/optimize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: rows.map(r => r.data),
          headers: headers,
          fixFirstRow: fixTopRow
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Optimization failed');
      }

      const result = await response.json();
      
      const newRows = result.data.map((r: string[], i: number) => ({
        id: `row-opt-${i}-${Date.now()}`,
        data: r
      }));

      setRows(newRows);
      
      // Update scoring immediately
      const results = calculateScore(headers, newRows.map((r: any) => r.data), aniloxIndices, inkIndices);
      setScoreResults(results);
      setIsPaneVisible(true);
    } catch (error) {
      console.error("Optimization error:", error);
      alert(`Optimization failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    
    // 1. Main Table Sheet
    const mainData = [headers, ...rows.map(r => r.data)];
    const wsMain = XLSX.utils.aoa_to_sheet(mainData);
    XLSX.utils.book_append_sheet(wb, wsMain, "Main Table");

    // 2. Scoring Details Sheet (if available)
    if (scoreResults) {
      const scoringData: any[][] = [
        ["Summary"],
        ["Metric", "Value"],
        ["Total Score", scoreResults.total_score],
        ["Anilox Changes", scoreResults.anilox_changes],
        ["Ink Changes", scoreResults.ink_changes],
        ["Added Stations", scoreResults.added_stations],
        [],
        ["Anilox Details"],
        ["Station", "Changes"]
      ];

      Object.entries(scoreResults.anilox_details).forEach(([station, count]) => {
        scoringData.push([station, count]);
      });

      scoringData.push([]);
      scoringData.push(["Added Station Details"]);
      scoringData.push(["Station", "Transitions"]);
      Object.entries(scoreResults.added_station_details).forEach(([station, count]) => {
        scoringData.push([station, count]);
      });

      scoringData.push([]);
      scoringData.push(["Ink Details"]);
      scoringData.push(["Station", "Changes"]);

      Object.entries(scoreResults.ink_details).forEach(([station, count]) => {
        scoringData.push([station, count]);
      });

      const wsScoring = XLSX.utils.aoa_to_sheet(scoringData);
      XLSX.utils.book_append_sheet(wb, wsScoring, "Scoring Details");
    }

    XLSX.writeFile(wb, "sequence_analysis.xlsx");
  };

  // Cell Drag and Drop Logic
  const onCellDragStart = (rowIndex: number, colIndex: number) => {
    // Boundaries: Anilox columns
    if (aniloxIndices.includes(colIndex)) {
      setDraggedCell({ rowIndex, colIndex });
    }
  };

  const onCellDrop = (targetRowIndex: number, targetColIndex: number) => {
    if (!draggedCell) return;
    const { rowIndex: sourceRowIndex, colIndex: sourceColIndex } = draggedCell;

    // Constraints:
    // 1. Same row
    if (sourceRowIndex !== targetRowIndex) {
      setDraggedCell(null);
      return;
    }

    // 2. Target must be an anilox column
    if (!aniloxIndices.includes(targetColIndex)) {
      setDraggedCell(null);
      return;
    }

    // 3. Direction: 1 cell left or 1 cell right
    const sourceAniloxIdx = aniloxIndices.indexOf(sourceColIndex);
    const targetAniloxIdx = aniloxIndices.indexOf(targetColIndex);
    const diff = Math.abs(sourceAniloxIdx - targetAniloxIdx);
    
    if (diff !== 1) {
      setDraggedCell(null);
      return;
    }

    // 4. Destination must be empty
    const targetValue = rows[targetRowIndex].data[targetColIndex];
    if (targetValue && targetValue.trim() !== "") {
      setDraggedCell(null);
      return;
    }

    // 5. Mirror move: find corresponding Ink columns
    const mirrorSourceCol = inkIndices[sourceAniloxIdx];
    const mirrorTargetCol = inkIndices[targetAniloxIdx];
    
    if (mirrorSourceCol === undefined || mirrorTargetCol === undefined) {
      setDraggedCell(null);
      return;
    }

    const mirrorTargetValue = rows[targetRowIndex].data[mirrorTargetCol];

    // If mirror destination is not empty, reject
    if (mirrorTargetValue && mirrorTargetValue.trim() !== "") {
      setDraggedCell(null);
      return;
    }

    // Perform moves
    saveToHistory();
    const newRows = [...rows];
    const rowData = [...newRows[sourceRowIndex].data];

    // Primary move
    rowData[targetColIndex] = rowData[sourceColIndex];
    rowData[sourceColIndex] = "";

    // Mirror move
    rowData[mirrorTargetCol] = rowData[mirrorSourceCol];
    rowData[mirrorSourceCol] = "";

    newRows[sourceRowIndex] = { ...newRows[sourceRowIndex], data: rowData };
    setRows(newRows);
    setDraggedCell(null);
    setScoreResults(null);
  };

  const addRow = () => {
    saveToHistory();
    const newRow: SequenceRow = {
      id: `row-${Date.now()}`,
      data: Array(headers.length).fill("")
    };
    setRows(prev => [...prev, newRow]);
  };

  const deleteRow = (id: string) => {
    saveToHistory();
    setRows(prev => prev.filter(r => r.id !== id));
    setScoreResults(null);
  };

  const handleCellEdit = (rowIndex: number, colIndex: number, value: string) => {
    const newRows = [...rows];
    const rowData = [...newRows[rowIndex].data];
    rowData[colIndex] = value;
    newRows[rowIndex] = { ...newRows[rowIndex], data: rowData };
    setRows(newRows);
    setScoreResults(null);
  };

  const handleRowReorder = (newRows: SequenceRow[]) => {
    setRows(newRows);
    setScoreResults(null);
  };

  return (
    <div className="flex flex-col h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-white border-bottom border-[#E4E3E0] shadow-sm z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-[#141414] text-white px-3 py-1.5 rounded-lg">
            <Play className="w-4 h-4 fill-current" />
            <span className="font-bold tracking-tight text-sm uppercase">Sequence Score</span>
          </div>
          
          <div className="h-6 w-px bg-[#E4E3E0]" />
          
          <button 
            onClick={undo}
            disabled={history.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-[#F1F1F1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            <Undo2 className="w-4 h-4" />
            Undo
          </button>

          <button 
            onClick={loadSampleData}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-[#F1F1F1] transition-colors text-sm font-medium"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>

          <label className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-[#F1F1F1] cursor-pointer transition-colors text-sm font-medium">
            <Upload className="w-4 h-4" />
            Upload
            <input type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFileUpload} />
          </label>

          <div className="h-6 w-px bg-[#E4E3E0]" />

          <div className="flex items-center gap-4">
            <button 
              onClick={handleOptimize}
              disabled={isOptimizing || rows.length === 0}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-bold uppercase tracking-wider"
            >
              {isOptimizing ? <RotateCcw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              Optimize
            </button>
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className="relative flex items-center">
                <input 
                  type="checkbox" 
                  checked={fixTopRow}
                  onChange={(e) => setFixTopRow(e.target.checked)}
                  className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-slate-300 checked:border-blue-600 checked:bg-blue-600 transition-all"
                />
                <svg className="absolute h-4 w-4 pointer-events-none hidden peer-checked:block stroke-white mt-1 ml-0.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <span className="text-xs font-medium text-[#8E9299] group-hover:text-[#1A1A1A] transition-colors">Fix top row</span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={addRow}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-[#F1F1F1] transition-colors text-sm font-medium"
          >
            <LayoutDashboard className="w-4 h-4" />
            Add Row
          </button>
          <button 
            onClick={handleScore}
            disabled={isScoring}
            className="flex items-center gap-2 bg-[#141414] text-white px-5 py-2 rounded-full hover:bg-[#333] transition-all active:scale-95 text-sm font-bold uppercase tracking-wider"
          >
            {isScoring ? <RotateCcw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            Score
          </button>

          <div className="h-6 w-px bg-[#E4E3E0]" />

          <button 
            onClick={() => setIsPaneVisible(!isPaneVisible)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md transition-all text-sm font-medium",
              isPaneVisible ? "bg-blue-50 text-blue-600" : "hover:bg-[#F1F1F1] text-[#8E9299]"
            )}
            title={isPaneVisible ? "Hide Analysis" : "Show Analysis"}
          >
            <LayoutDashboard className="w-4 h-4" />
            {isPaneVisible ? "Hide" : "Show"}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left Pane: Table */}
        <section className="flex-1 flex flex-col border-r border-[#E4E3E0] bg-white overflow-hidden relative">
          <div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full border-collapse text-xs table-fixed min-w-[1800px]">
              <thead className="sticky top-0 z-40 bg-[#F8F9FA] shadow-sm">
                <tr>
                  <th className="w-10 p-2 border-b border-r border-[#E4E3E0]"></th>
                  <th className="w-10 p-2 border-b border-r border-[#E4E3E0]"></th>
                  {headers.map((header, i) => (
                    <th 
                      key={i} 
                      className={cn(
                        "p-3 text-left font-mono italic uppercase tracking-wider text-[10px] text-[#8E9299] border-b border-r border-[#E4E3E0]",
                        aniloxIndices.includes(i) ? "bg-blue-50/50" : "",
                        inkIndices.includes(i) ? "bg-orange-50/50" : ""
                      )}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <Reorder.Group axis="y" values={rows} onReorder={handleRowReorder} as="tbody">
                {rows.map((row, rowIndex) => (
                  <Reorder.Item 
                    key={row.id} 
                    value={row}
                    as="tr"
                    onDragStart={saveToHistory}
                    className="group hover:bg-[#F1F1F1] transition-colors"
                  >
                    <td className="p-2 border-b border-r border-[#E4E3E0] text-center cursor-grab active:cursor-grabbing">
                      <GripVertical className="w-4 h-4 text-[#8E9299] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </td>
                    <td className="p-2 border-b border-r border-[#E4E3E0] text-center">
                      <button 
                        onClick={() => deleteRow(row.id)}
                        className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </td>
                    {row.data.map((cell, colIndex) => {
                      const isAnilox = aniloxIndices.includes(colIndex);
                      const isInk = inkIndices.includes(colIndex);
                      const isMetadata = !isAnilox && !isInk;
                      const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.colIndex === colIndex;

                      return (
                        <td 
                          key={colIndex}
                          draggable={isAnilox && cell !== ""}
                          onDragStart={() => onCellDragStart(rowIndex, colIndex)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => onCellDrop(rowIndex, colIndex)}
                          onClick={() => isMetadata && setEditingCell({ rowIndex, colIndex })}
                          className={cn(
                            "p-2 border-b border-r border-[#E4E3E0] truncate font-mono transition-all relative",
                            isAnilox ? "bg-blue-50/20" : "",
                            isInk ? "bg-orange-50/20" : "",
                            draggedCell?.rowIndex === rowIndex && draggedCell?.colIndex === colIndex ? "opacity-30 scale-95" : "",
                            // Highlight mirror cell when dragging
                            draggedCell?.rowIndex === rowIndex && 
                            inkIndices[aniloxIndices.indexOf(draggedCell.colIndex)] === colIndex ? "ring-2 ring-orange-400 ring-inset" : "",
                            cell === "" ? "bg-gray-50/30" : "cursor-default",
                            isMetadata ? "cursor-text hover:bg-gray-100/50" : ""
                          )}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              className="absolute inset-0 w-full h-full px-2 bg-white outline-none ring-2 ring-blue-500 z-10"
                              value={cell}
                              onFocus={saveToHistory}
                              onChange={(e) => handleCellEdit(rowIndex, colIndex, e.target.value)}
                              onBlur={() => setEditingCell(null)}
                              onKeyDown={(e) => e.key === 'Enter' && setEditingCell(null)}
                            />
                          ) : (
                            cell
                          )}
                        </td>
                      );
                    })}
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            </table>
          </div>
          
          {/* Permanent Horizontal Scrollbar Indicator */}
          <div className="h-2 bg-[#F1F1F1] border-t border-[#E4E3E0] flex items-center px-4">
            <div className="text-[9px] text-[#8E9299] font-mono uppercase tracking-widest">
              Scroll horizontally to view all stations
            </div>
          </div>
        </section>

        {/* Right Pane: Results */}
        <AnimatePresence>
          {isPaneVisible && (
            <motion.aside 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 400, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="flex flex-col bg-[#151619] text-white overflow-hidden border-l border-white/10"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between min-w-[400px]">
                <h2 className="text-xl font-light tracking-tight flex items-center gap-2">
                  <Info className="w-5 h-5 text-blue-400" />
                  Scoring Analysis
                </h2>
                {scoreResults && (
                  <div className="px-3 py-1 bg-blue-500 rounded-full text-[10px] font-bold uppercase tracking-widest">
                    Calculated
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar-dark min-w-[400px]">
                {!scoreResults ? (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                    <div className="w-16 h-16 border-2 border-dashed border-white/20 rounded-full flex items-center justify-center mb-4">
                      <Play className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-mono uppercase tracking-wider">Click "Score" to analyze current sequence</p>
                  </div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-8"
                  >
                    {/* Total Score */}
                    <div className="bg-white/5 rounded-2xl p-6 border border-white/10 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Play className="w-12 h-12" />
                      </div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-[#8E9299] block mb-2">Total Sequence Score</label>
                      <div className="text-6xl font-light tracking-tighter text-blue-400">
                        {scoreResults.total_score}
                      </div>
                      <div className="mt-4 text-[11px] text-[#8E9299] font-mono">
                        (7 × {scoreResults.anilox_changes}) + (4 × {scoreResults.ink_changes}) + {scoreResults.added_stations}
                      </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                        <label className="text-[9px] font-mono uppercase tracking-widest text-[#8E9299] block mb-1">Anilox Changes</label>
                        <div className="text-2xl font-medium">{scoreResults.anilox_changes}</div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                        <label className="text-[9px] font-mono uppercase tracking-widest text-[#8E9299] block mb-1">Ink Changes</label>
                        <div className="text-2xl font-medium">{scoreResults.ink_changes}</div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-4 border border-white/10 col-span-2">
                        <label className="text-[9px] font-mono uppercase tracking-widest text-[#8E9299] block mb-1">Added Stations</label>
                        <div className="text-2xl font-medium">{scoreResults.added_stations}</div>
                      </div>
                    </div>

                    {/* Detailed Breakdown */}
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <h3 className="text-xs font-mono uppercase tracking-widest text-[#8E9299] border-b border-white/10 pb-2">Anilox Stations</h3>
                        
                        <div className="space-y-2">
                          {Object.entries(scoreResults.anilox_details).map(([station, count]) => (
                            <div key={station} className="flex items-center justify-between text-[11px] font-mono">
                              <span className="text-[#8E9299]">{station}</span>
                              <div className="flex items-center gap-2">
                                <div className="h-1 bg-blue-500/20 rounded-full w-24 overflow-hidden">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.min(100, ((count as number) / 10) * 100)}%` }}
                                    className="h-full bg-blue-500"
                                  />
                                </div>
                                <span>{count}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-xs font-mono uppercase tracking-widest text-[#8E9299] border-b border-white/10 pb-2">Ink Stations</h3>
                        
                        <div className="space-y-2">
                          {Object.entries(scoreResults.ink_details).map(([station, count]) => (
                            <div key={station} className="flex items-center justify-between text-[11px] font-mono">
                              <span className="text-[#8E9299]">{station}</span>
                              <div className="flex items-center gap-2">
                                <div className="h-1 bg-orange-500/20 rounded-full w-24 overflow-hidden">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.min(100, ((count as number) / 10) * 100)}%` }}
                                    className="h-full bg-orange-500"
                                  />
                                </div>
                                <span>{count}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-xs font-mono uppercase tracking-widest text-[#8E9299] border-b border-white/10 pb-2">Added Stations</h3>
                        
                        <div className="space-y-2">
                          {Object.entries(scoreResults.added_station_details).map(([station, count]) => (
                            <div key={station} className="flex items-center justify-between text-[11px] font-mono">
                              <span className="text-[#8E9299]">{station}</span>
                              <div className="flex items-center gap-2">
                                <div className="h-1 bg-green-500/20 rounded-full w-24 overflow-hidden">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.min(100, ((count as number) / 10) * 100)}%` }}
                                    className="h-full bg-green-500"
                                  />
                                </div>
                                <span>{count}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>

              <div className="p-6 bg-black/20 border-t border-white/10 min-w-[400px]">
                <button 
                  onClick={handleExportExcel}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors text-xs font-bold uppercase tracking-widest"
                >
                  <Download className="w-4 h-4" />
                  Export Excel
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 12px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #F1F1F1;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #D1D1D1;
          border-radius: 10px;
          border: 3px solid #F1F1F1;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #8E9299;
        }

        .custom-scrollbar-dark::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar-dark::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 10px;
        }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.2);
        }

        /* Force horizontal scrollbar visibility */
        .custom-scrollbar {
          scrollbar-color: #D1D1D1 #F1F1F1;
          scrollbar-width: auto;
        }
      `}} />
    </div>
  );
}
