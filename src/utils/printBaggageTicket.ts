import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { getPrintCustomization } from '../services/printCustomization';

export interface BaggageTicketData {
  baggage_number: string;
  destination: string;
  price: number;
  seat_number: string | null;
  departure_number: number | null;
  bus_registration: string | null;
  description: string | null;
  owner_name: string;
  owner_phone: string;
  station_name: string;
  mode_label?: string | null;
}

function fmtAmount(n: number): string {
  const str = Math.round(n).toString();
  let result = '';
  for (let i = 0; i < str.length; i++) {
    if (i > 0 && (str.length - i) % 3 === 0) result += ' ';
    result += str[i];
  }
  return result + ' F';
}

export async function printBaggageTicket(data: BaggageTicketData) {
  const customization = await getPrintCustomization();
  const phoneLine = customization.bus_ticket_phones[0] || '01 14 34 60 / 01 14 34 87';
  const customNotes = customization.baggage_notes;
  const W = 80;
  const L = 4;
  const R = 76;
  const MID = W / 2;
  const now = new Date();
  const dateStr = format(now, 'dd/MM/yyyy');
  const timeStr = format(now, 'HH:mm');

  const doc = new jsPDF({ unit: 'mm', format: [W, 230] });

  const solid = (y: number, x1 = L, x2 = R) => {
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.line(x1, y, x2, y);
  };
  const dashed = (y: number, x1 = L, x2 = R) => {
    doc.setLineDashPattern([1.2, 1.0], 0);
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.line(x1, y, x2, y);
    doc.setLineDashPattern([], 0);
  };
  const heavyDotted = (y: number) => {
    doc.setLineDashPattern([1.5, 1.0], 0);
    doc.setDrawColor(0);
    doc.setLineWidth(0.55);
    doc.line(2, y, 78, y);
    doc.setLineDashPattern([], 0);
  };

  const renderSection = (startY: number, isSouche: boolean): number => {
    let y = startY;

    // -- Header (main ticket only) --
    if (!isSouche) {
      try {
        doc.addImage('/logo_sbta02.JPG', 'JPEG', L - 1, y, 18, 16);
      } catch {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(0);
        doc.text('S.B.T.A', 12, y + 8, { align: 'center' });
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(0);
      doc.text('SBTA', R, y + 9, { align: 'right' });
      doc.setFontSize(5);
      doc.setFont('helvetica', 'normal');
      doc.text("Societe Bonkoungou Transport de L'Agneby", R, y + 13, { align: 'right' });
      doc.text(`Tel ${phoneLine}`, R, y + 16, { align: 'right' });

      y += 18;
      solid(y);
      y += 2;
    }

    // -- Title --
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(isSouche ? 'SOUCHE BAGAGE' : 'TICKET BAGAGE', MID, y + 5, { align: 'center' });
    y += 8;

    if (data.mode_label) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(data.mode_label.toUpperCase(), MID, y + 2, { align: 'center' });
      y += 4;
    }

    dashed(y);
    y += 3;

    // -- N Bagage --
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('N BAGAGE', L, y + 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(data.baggage_number, R, y + 1, { align: 'right' });
    y += 5;
    dashed(y);
    y += 3;

    // -- Depart + Destination row --
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('DEPART', L, y + 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const depNum = data.departure_number ? String(data.departure_number) : '--';
    doc.text(depNum, L + 20, y + 1);

    doc.setLineWidth(0.2);
    doc.line(L + 30, y - 2, L + 30, y + 3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('DESTINATION', L + 33, y + 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(data.destination.toUpperCase(), R, y + 1, { align: 'right' });
    y += 5;
    dashed(y);
    y += 3;

    // -- Siege | Prix row --
    const isSansTicket = data.mode_label?.toLowerCase().includes('sans siege');
    if (!isSansTicket) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text('SIEGE', L, y + 1);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(data.seat_number || '--', L + 18, y + 1);

      doc.setLineWidth(0.2);
      doc.line(MID - 2, y - 2, MID - 2, y + 3);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text('PRIX', MID + 1, y + 1);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(fmtAmount(data.price), R, y + 1, { align: 'right' });
      y += 5;
      dashed(y);
      y += 3;
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text('PRIX', L, y + 1);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(fmtAmount(data.price), R, y + 1, { align: 'right' });
      y += 5;
      dashed(y);
      y += 3;
    }

    // -- Car row --
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('CAR', L, y + 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(data.bus_registration || '--', R, y + 1, { align: 'right' });
    y += 5;
    dashed(y);
    y += 3;

    // -- Date | Heure row --
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('DATE', L, y + 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(dateStr, L + 16, y + 1);

    doc.setLineWidth(0.2);
    doc.line(MID - 2, y - 2, MID - 2, y + 3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('HEURE', MID + 1, y + 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(timeStr, R, y + 1, { align: 'right' });
    y += 5;
    dashed(y);
    y += 3;

    // -- Proprietaire --
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('PROPRIETAIRE', L, y + 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const nameLines = doc.splitTextToSize(data.owner_name.toUpperCase(), R - L - 30);
    doc.text(nameLines[0] || '', R, y + 1, { align: 'right' });
    y += 4;

    // -- Contact --
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('CONTACT', L, y + 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(data.owner_phone, R, y + 1, { align: 'right' });
    y += 5;

    // -- Description (if any) --
    if (data.description) {
      dashed(y);
      y += 3;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text('DESCRIPTION', L, y + 1);
      y += 3;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      const descLines = doc.splitTextToSize(data.description.toUpperCase(), R - L - 2);
      for (let i = 0; i < Math.min(descLines.length, 3); i++) {
        doc.text(descLines[i], L + 1, y + 1);
        y += 3;
      }
    }

    y += 1;
    solid(y);
    y += 2;

    // -- OK mention --
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('OK', MID, y + 4, { align: 'center' });
    y += 7;

    // -- Gare --
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.text(data.station_name, MID, y + 1, { align: 'center' });
    y += 3;

    // -- Custom notes (main ticket only) --
    if (!isSouche && customNotes.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5);
      for (const note of customNotes) {
        const noteLines = doc.splitTextToSize(note, R - L - 2);
        for (let i = 0; i < Math.min(noteLines.length, 3); i++) {
          doc.text(noteLines[i], L + 1, y + 1);
          y += 2.5;
        }
      }
      y += 1;
    }

    // outer border
    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
    doc.rect(2, startY - 1, W - 4, y - startY + 2);

    return y + 2;
  };

  // Main ticket
  let y = renderSection(3, false);

  // Separator
  heavyDotted(y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5);
  doc.text('DECOUPER ICI', MID, y + 2.5, { align: 'center' });
  y += 5;

  // Souche
  renderSection(y, true);

  doc.save(`bagage_${data.baggage_number}.pdf`);
}

export function generateBaggageNumber(): string {
  const now = new Date();
  const d = format(now, 'yyyyMMdd');
  const t = format(now, 'HHmmss');
  return `${d}_${t}`;
}
