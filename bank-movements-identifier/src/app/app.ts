import { Component } from '@angular/core';
import { ExcelParserService } from './services/excel-parser.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [], 
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class AppComponent {
  dragging = false;
  fileName = '';
  excelData: any[][] | null = null;

  constructor(private excelParser: ExcelParserService) {}

  // Detetar ficheiro via botão Browse
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
  }

  // Lógica de Drag & Drop
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging = false;

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.handleFile(event.dataTransfer.files[0]);
    }
  }

  // Processamento do ficheiro
  async handleFile(file: File): Promise<void> {
    this.fileName = file.name;
    try {
      this.excelData = await this.excelParser.parseExcel(file);
    } catch (error) {
      alert('Erro ao ler o ficheiro Excel. Verifica o formato.');
      this.fileName = '';
    }
  }

  // Métodos auxiliares para o template
  getHeaderRow(): any[] {
    return this.excelData && this.excelData.length > 0 ? this.excelData[0] : [];
  }

  getDisplayRows(): any[][] {
    // Retorna as linhas 1 a 11 (excluindo o cabeçalho bruto)
    return this.excelData ? this.excelData.slice(1, 11) : [];
  }
}