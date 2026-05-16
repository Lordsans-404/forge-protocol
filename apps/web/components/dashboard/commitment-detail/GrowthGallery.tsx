import React, { useEffect, useState } from 'react';
import { Camera, Image as ImageIcon, Loader2 } from 'lucide-react';

interface ProofImage {
    id: string;
    storage_root_hash: string;
    image_url: string;
    created_at: string;
}

export function GrowthGallery({ walletAddress }: { walletAddress?: string }) {
    const [images, setImages] = useState<ProofImage[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!walletAddress) {
            setLoading(false);
            return;
        }

        async function fetchGallery() {
            try {
                const res = await fetch(`/api/gallery?walletAddress=${walletAddress}`);
                if (res.ok) {
                    const data = await res.json();
                    setImages(data.gallery || []);
                }
            } catch (err) {
                console.error('Failed to fetch gallery', err);
            } finally {
                setLoading(false);
            }
        }

        fetchGallery();
    }, [walletAddress]);

    return (
        <div className="bg-card/40 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)] mt-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="bg-primary/20 p-2 rounded-lg">
                    <Camera className="w-5 h-5 text-primary" />
                </div>
                <h4 className="font-headline-card text-lg text-white">My Growth Journey</h4>
            </div>

            {loading ? (
                <div className="flex justify-center items-center py-8">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
            ) : images.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                    {images.map((img) => (
                        <div key={img.id} className="relative group rounded-xl overflow-hidden aspect-square bg-white/5 border border-white/10">
                            <img 
                                src={img.image_url} 
                                alt="Proof" 
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                                <span className="text-[10px] text-white/80 font-body-main uppercase tracking-wider">
                                    {new Date(img.created_at).toLocaleDateString()}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center border border-dashed border-white/10 rounded-xl bg-white/5">
                    <ImageIcon className="w-10 h-10 text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground font-body-main">No progress photos yet.</p>
                    <p className="text-xs text-white/40 mt-1">Submit your first proof to start your gallery!</p>
                </div>
            )}
        </div>
    );
}
