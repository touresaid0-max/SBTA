import { formatCFA } from '@/services/abg.service'

type Row = Record<string, string | number>

export async function exportExcel(rows: Row[], filename: string, sheetName = 'Rapport'): Promise<void> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

export async function exportPDF(
  title: string,
  subtitle: string,
  headers: string[],
  rows: (string | number)[][],
  totalsRow?: (string | number)[],
  filename: string = 'rapport.pdf',
): Promise<void> {
  const { jsPDF } = await import('jspdf')

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14
  let y = 20

  // Title
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(title, margin, y)
  y += 6

  // Subtitle
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100)
  doc.text(subtitle, margin, y)
  y += 8
  doc.setTextColor(0)

  // Table
  const colWidth = (pageWidth - 2 * margin) / headers.length
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')

  // Headers
  doc.setFillColor(240, 248, 244)
  doc.rect(margin, y - 4, pageWidth - 2 * margin, 7, 'F')
  headers.forEach((h, i) => {
    const x = margin + i * colWidth
    if (i === 0) {
      doc.text(h, x + 2, y)
    } else {
      doc.text(h, x + colWidth - 2, y, { align: 'right' })
    }
  })
  y += 7

  // Rows
  doc.setFont('helvetica', 'normal')
  rows.forEach((row, ri) => {
    if (y > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage()
      y = 20
      doc.setFillColor(240, 248, 244)
      doc.rect(margin, y - 4, pageWidth - 2 * margin, 7, 'F')
      doc.setFont('helvetica', 'bold')
      headers.forEach((h, i) => {
        const x = margin + i * colWidth
        if (i === 0) { doc.text(h, x + 2, y) } else { doc.text(h, x + colWidth - 2, y, { align: 'right' }) }
      })
      y += 7
      doc.setFont('helvetica', 'normal')
    }
    if (ri % 2 === 0) {
      doc.setFillColor(248, 250, 248)
      doc.rect(margin, y - 4, pageWidth - 2 * margin, 6, 'F')
    }
    row.forEach((cell, i) => {
      const x = margin + i * colWidth
      const text = String(cell)
      if (i === 0) {
        doc.text(text, x + 2, y)
      } else {
        doc.text(text, x + colWidth - 2, y, { align: 'right' })
      }
    })
    y += 6
  })

  // Totals
  if (totalsRow) {
    y += 2
    doc.setFont('helvetica', 'bold')
    doc.setDrawColor(200, 210, 205)
    doc.line(margin, y - 5, pageWidth - margin, y - 5)
    totalsRow.forEach((cell, i) => {
      const x = margin + i * colWidth
      const text = String(cell)
      if (i === 0) {
        doc.text(text, x + 2, y)
      } else {
        doc.text(text, x + colWidth - 2, y, { align: 'right' })
      }
    })
  }

  // Footer
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(150)
  doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, margin, doc.internal.pageSize.getHeight() - 8)

  doc.save(filename)
}

export function exportTableExcel(
  title: string,
  headers: string[],
  dataRows: (string | number)[][],
  totalsRow: (string | number)[],
  filename: string,
): void {
  const rows: Row[] = []
  rows.push({ [headers[0]]: title, ...Object.fromEntries(headers.slice(1).map(h => [h, ''])) })
  const headerRow: Row = {}
  headers.forEach(h => { headerRow[h] = h })
  rows.push(headerRow)
  dataRows.forEach(row => {
    const r: Row = {}
    headers.forEach((h, i) => { r[h] = row[i] })
    rows.push(r)
  })
  if (totalsRow.length > 0) {
    const r: Row = {}
    headers.forEach((h, i) => { r[h] = totalsRow[i] ?? '' })
    rows.push(r)
  }
  void exportExcel(rows, filename, title.slice(0, 28))
}

export { formatCFA }
