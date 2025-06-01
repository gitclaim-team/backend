import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Bounty extends Document {
  @Prop({ required: true })
  repo: string;

  @Prop({ required: true })
  issue: number;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  coin: string; // Coin ticker, e.g., USDC, USDT

  @Prop({ required: true })
  chain_id: string;

  @Prop({ required: true })
  bountyOwner: string; // GitHub handle of the person issuing the bounty

  @Prop({ default: 'open' })
  status: string; // open, closed, etc.

  @Prop({
    type: [{ language: String, percentage: Number }],
    default: []
  })
  languages: { language: string; percentage: number }[];

  @Prop({
    type: [{
      number: Number,
      repo: String,
      url: String,
      author: String,
      createdAt: Date,
      evm_address: { type: String, required: false },
      webproof_source: { type: String, required: false },
    }],
    default: []
  })
  pull_requests: {
    number: number;
    repo: string;
    url: string;
    author: string;
    createdAt: Date;
    evm_address?: string;
    webproof_source?: string;
  }[];
}

export const BountySchema = SchemaFactory.createForClass(Bounty);

BountySchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
}); 