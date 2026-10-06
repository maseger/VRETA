import { ClipboardPaste, Copy } from "lucide-react";
import { useApp } from "../app/AppContext";
import { copyText } from "../services/share";

/** Påminnelse efter delning: texten följer inte med till Facebook/Instagram och måste klistras in. */
export function PasteHint({ text, where, copied }: { text: string; where: string; copied: boolean }) {
  const { toast } = useApp();
  return (
    <div className="card mb-3 border-linolja/40 bg-linolja-pale/40 p-4" role="status">
      <p className="mb-1 flex items-center gap-2 font-semibold"><ClipboardPaste size={18} className="text-linolja" aria-hidden="true" /> Klistra in texten i {where}</p>
      <p className="mb-3 text-sm text-sot-2">
        {where} tar bara med bilderna, inte texten. {copied ? "Texten är kopierad – " : "Kopiera texten och "}
        tryck länge i textrutan i inlägget och välj <strong>Klistra in</strong>.
      </p>
      <button type="button" className="btn-secondary text-sm" onClick={async () => toast((await copyText(text)) ? "Texten är kopierad" : "Kunde inte kopiera – markera texten ovan och kopiera")}>
        <Copy size={16} aria-hidden="true" /> {copied ? "Kopiera texten igen" : "Kopiera texten"}
      </button>
    </div>
  );
}

/** Kort förvarning vid delningsknappen. */
export function PasteNote({ where }: { where: string }) {
  return <p className="mt-2 text-center text-[12px] text-sot-3">{where} tar bara med bilderna – texten kopieras så att du kan klistra in den i inlägget.</p>;
}
