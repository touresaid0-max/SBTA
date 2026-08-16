import jsPDF from 'jspdf'

export interface ReportFilters {
  dateFrom: string
  dateTo: string
  groupeId: string | null
}

export function formatFCFA(n: number | string | null | undefined): string {
  const num = Number(n ?? 0)
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(num) + ' FCFA'
}

export function formatFCFAShort(n: number | string | null | undefined): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n ?? 0))
}

export function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('fr-FR')
}

export function formatDateTime(d: string | Date): string {
  return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export function currentMonthName(): string {
  return new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

interface ReportHeaderData {
  title: string
  subtitle?: string
  userName: string
  dateFrom: string
  dateTo: string
}

export function addReportHeader(doc: jsPDF, data: ReportHeaderData, pageWidth: number) {
  const margin = 14
  let y = 16

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(11, 116, 57)
  doc.text('GARAGE SBTA', pageWidth / 2, y, { align: 'center' })
  y += 7

  doc.setFontSize(12)
  doc.setTextColor(26, 46, 34)
  doc.text(data.title, pageWidth / 2, y, { align: 'center' })
  y += 6

  if (data.subtitle) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(74, 107, 85)
    doc.text(data.subtitle, pageWidth / 2, y, { align: 'center' })
    y += 5
  }

  y += 2
  doc.setFontSize(8)
  doc.setTextColor(107, 112, 128)
  const period = `Période du ${formatDate(data.dateFrom)} au ${formatDate(data.dateTo)}`
  doc.text(period, margin, y)
  const editedBy = `Edité par : ${data.userName} (Le ${formatDateTime(new Date())}) Via : Logiciel GARAGE SBTA`
  doc.text(editedBy, margin, y + 4)

  y += 10
  doc.setDrawColor(11, 116, 57)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pageWidth - margin, y)
  return y + 6
}

export function addReportFooter(doc: jsPDF, pageHeight: number, pageWidth: number) {
  const margin = 14
  const y = pageHeight - 16
  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(107, 112, 128)
  doc.text(`Fait à Abidjan, le ${formatDate(new Date())}`, margin, y)
  doc.line(margin, y + 2, pageWidth - margin, y + 2)
}

export function ensureSpace(doc: jsPDF, y: number, needed: number, pageHeight: number, pageWidth: number): number {
  if (y + needed > pageHeight - 25) {
    addReportFooter(doc, pageHeight, pageWidth)
    doc.addPage()
    return 20
  }
  return y
}
